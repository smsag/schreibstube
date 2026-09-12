import { describe, expect, it } from "vitest";
import { isGlossaryNote, parseGlossary, preferredTerm } from "./glossary-parser";

const NOTE = `---
schreibstubeGlossary: true
schreibstubeLanguage: de
schreibstubeDefaultSeverity: error
---

# Hausglossar

| Concept | Term         | Status     | Match | Note                  |
|---------|--------------|------------|-------|-----------------------|
| objekt  | Objekt       | preferred  | word  |                       |
| objekt  | Immobilie    | deprecated | word  | Hausbegriff seit 2024 |
| objekt  | Liegenschaft | admitted   |       |                       |
| makler  | Broker       | deprecated | word  |                       |
`;

describe("isGlossaryNote", () => {
  it("accepts a note carrying the marker", () => {
    expect(isGlossaryNote(NOTE)).toBe(true);
  });

  it("rejects a plain note", () => {
    expect(isGlossaryNote("# Notes\n\nSome text.")).toBe(false);
  });

  it("rejects a note whose marker is false", () => {
    expect(isGlossaryNote("---\nschreibstubeGlossary: false\n---\n")).toBe(false);
  });

  it("does not accept the removed kebab-case marker", () => {
    expect(isGlossaryNote("---\nschreibstube-glossary: true\n---\n")).toBe(false);
  });

  it("is case sensitive about the marker", () => {
    expect(isGlossaryNote("---\nschreibstubeglossary: true\n---\n")).toBe(false);
  });
});

describe("parseGlossary", () => {
  it("reads frontmatter settings", () => {
    const { glossary } = parseGlossary("G.md", NOTE);
    expect(glossary.language).toBe("de");
    expect(glossary.defaultSeverity).toBe("error");
    expect(glossary.path).toBe("G.md");
  });

  it("groups terms by concept", () => {
    const { glossary, errors } = parseGlossary("G.md", NOTE);
    expect(errors).toEqual([]);
    expect(glossary.concepts.map((c) => c.id)).toEqual(["objekt", "makler"]);
    expect(glossary.concepts[0].terms).toHaveLength(3);
  });

  it("exposes the preferred term of a concept", () => {
    const { glossary } = parseGlossary("G.md", NOTE);
    expect(preferredTerm(glossary.concepts[0])).toBe("Objekt");
  });

  it("returns null preferred term for a concept that only forbids", () => {
    const { glossary } = parseGlossary("G.md", NOTE);
    expect(preferredTerm(glossary.concepts[1])).toBe(null);
  });

  it("ignores an unprefixed language key", () => {
    const { glossary } = parseGlossary(
      "G.md",
      "---\nlanguage: en\n---\n\n| Concept | Term | Status |\n|---|---|---|\n| a | B | preferred |"
    );
    expect(glossary.language).toBe("de");
  });

  it("ignores an unprefixed defaultSeverity key", () => {
    const { glossary } = parseGlossary(
      "G.md",
      "---\ndefaultSeverity: error\n---\n\n| Concept | Term | Status |\n|---|---|---|\n| a | B | preferred |"
    );
    expect(glossary.defaultSeverity).toBe("warning");
  });

  it("reads the prefixed language key", () => {
    const { glossary } = parseGlossary(
      "G.md",
      "---\nschreibstubeLanguage: en\n---\n\n| Concept | Term | Status |\n|---|---|---|\n| a | B | preferred |"
    );
    expect(glossary.language).toBe("en");
  });

  it("ignores the removed default-severity spelling", () => {
    const { glossary } = parseGlossary(
      "G.md",
      "---\ndefault-severity: error\n---\n\n| Concept | Term | Status |\n|---|---|---|\n| a | B | preferred |"
    );
    expect(glossary.defaultSeverity).toBe("warning");
  });

  it("defaults language and severity when frontmatter omits them", () => {
    const { glossary } = parseGlossary(
      "G.md",
      "| Concept | Term | Status |\n| a | B | preferred |"
    );
    expect(glossary.language).toBe("de");
    expect(glossary.defaultSeverity).toBe("warning");
  });

  it("accepts TBX picklist status identifiers", () => {
    const { glossary, errors } = parseGlossary(
      "G.md",
      "| Concept | Term | Status |\n|---|---|---|\n| a | X | deprecatedTerm-admn-sts |"
    );
    expect(errors).toEqual([]);
    expect(glossary.concepts[0].terms[0].status).toBe("deprecated");
  });

  it("accepts the informal notRecommended and obsolete spellings", () => {
    const { glossary } = parseGlossary(
      "G.md",
      "| Concept | Term | Status |\n|---|---|---|\n| a | X | notRecommended |\n| a | Y | obsolete |"
    );
    expect(glossary.concepts[0].terms.map((t) => t.status)).toEqual(["deprecated", "superseded"]);
  });

  it("accepts German column headers", () => {
    const { glossary, errors } = parseGlossary(
      "G.md",
      "| Konzept | Benennung | Status | Hinweis |\n|---|---|---|---|\n| a | Objekt | preferred | ok |"
    );
    expect(errors).toEqual([]);
    expect(glossary.concepts[0].terms[0].text).toBe("Objekt");
    expect(glossary.concepts[0].terms[0].note).toBe("ok");
  });

  it("skips a row with an unknown status and reports it", () => {
    const { glossary, errors } = parseGlossary(
      "G.md",
      "| Concept | Term | Status |\n|---|---|---|\n| a | X | vielleicht |\n| a | Y | preferred |"
    );
    expect(glossary.concepts[0].terms).toHaveLength(1);
    expect(errors[0]).toContain("vielleicht");
  });

  it("skips a row missing its term and keeps parsing", () => {
    const { glossary, errors } = parseGlossary(
      "G.md",
      "| Concept | Term | Status |\n|---|---|---|\n| a |  | preferred |\n| b | Y | preferred |"
    );
    expect(glossary.concepts.map((c) => c.id)).toEqual(["b"]);
    expect(errors).toHaveLength(1);
  });

  it("reports two preferred terms in one concept but keeps the rows", () => {
    const { glossary, errors } = parseGlossary(
      "G.md",
      "| Concept | Term | Status |\n|---|---|---|\n| a | X | preferred |\n| a | Y | preferred |"
    );
    expect(errors[0]).toContain("preferred terms");
    expect(preferredTerm(glossary.concepts[0])).toBe("X");
  });

  it("skips a duplicate term inside one concept", () => {
    const { glossary, errors } = parseGlossary(
      "G.md",
      "| Concept | Term | Status |\n|---|---|---|\n| a | X | preferred |\n| a | x | deprecated |"
    );
    expect(glossary.concepts[0].terms).toHaveLength(1);
    expect(errors[0]).toContain("already defined");
  });

  it("falls back to word matching on an unknown match mode", () => {
    const { glossary, errors } = parseGlossary(
      "G.md",
      "| Concept | Term | Status | Match |\n|---|---|---|---|\n| a | X | preferred | fuzzy |"
    );
    expect(glossary.concepts[0].terms[0].match).toBe("word");
    expect(errors[0]).toContain("fuzzy");
  });

  it("reports a note with no table", () => {
    const { glossary, errors } = parseGlossary("G.md", "# Empty\n\nNothing here.");
    expect(glossary.concepts).toEqual([]);
    expect(errors).toEqual(["No term table found."]);
  });

  it("reports missing required columns", () => {
    const { errors } = parseGlossary("G.md", "| Term | Note |\n|---|---|\n| X | y |");
    expect(errors[0]).toContain("Missing required column");
  });
});
