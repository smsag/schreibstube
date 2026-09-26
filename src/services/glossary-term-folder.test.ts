import { describe, expect, it } from "vitest";
import { compileGlossaries } from "./glossary-matcher";
import {
  addAvoid,
  buildTermFolderGlossaries,
  definitionExcerpt,
  isInTermFolder,
  isTermNote,
  MAX_AVOID_CHARS,
  MAX_AVOID_PER_TERM,
  MAX_DEFINITION_CHARS,
  normalizeTermFolder,
  readAvoidList,
  readTermRule,
  removeAvoid,
  TERM_AVOID_KEY,
  type TermNote
} from "./glossary-term-folder";

/** A term note exactly as Pythia writes one (its ADR-150 format), with the one
 *  key this plugin adds. If Pythia's format changes, this is the fixture to
 *  update, and the tests below say what the change breaks. */
const PYTHIA_NOTE = [
  "---",
  "type: term",
  "aliases: [Kartellrechts]",
  "theme: ['[[Wettbewerb]]']",
  "term_en: cartel law",
  "source: model",
  "language: de",
  `${TERM_AVOID_KEY}: [cartel law, Wettbewerbsrecht]`,
  "---",
  "Das Recht gegen Absprachen und Marktmacht, die den Wettbewerb beschränken.",
  "",
  "> Das Kartellrecht verbietet Preisabsprachen.",
  "",
  "## Discussion",
  "",
  "Eigene Notizen."
].join("\n");

const note = (
  frontmatter: Record<string, unknown> | undefined,
  basename = "Kartellrecht"
): TermNote => ({
  path: `Glossar/Terms/${basename}.md`,
  basename,
  frontmatter
});

describe("normalizeTermFolder", () => {
  it("trims and strips slashes", () => {
    expect(normalizeTermFolder("  /Glossar/ ")).toBe("Glossar");
  });
  it("is empty for anything but a string", () => {
    expect(normalizeTermFolder(3)).toBe("");
    expect(normalizeTermFolder(undefined)).toBe("");
  });
});

describe("isInTermFolder", () => {
  it("matches notes beneath the folder, at any depth", () => {
    expect(isInTermFolder("Glossar/Terms/A.md", "Glossar")).toBe(true);
  });
  it("does not match a sibling that shares the prefix", () => {
    expect(isInTermFolder("Glossary/A.md", "Glossar")).toBe(false);
  });
  it("matches nothing when no folder is set", () => {
    expect(isInTermFolder("A.md", "")).toBe(false);
  });
});

describe("isTermNote", () => {
  it("takes a note with no type, or type term", () => {
    expect(isTermNote(undefined)).toBe(true);
    expect(isTermNote({ type: "term" })).toBe(true);
    expect(isTermNote({ type: " Term " })).toBe(true);
  });
  it("leaves out people and themes, and a type that is not a string", () => {
    expect(isTermNote({ type: "person" })).toBe(false);
    expect(isTermNote({ type: "theme" })).toBe(false);
    expect(isTermNote({ type: ["term"] })).toBe(false);
  });
});

describe("readAvoidList", () => {
  it("accepts a list or a comma string", () => {
    expect(readAvoidList(["a", "b"])).toEqual(["a", "b"]);
    expect(readAvoidList("a, b")).toEqual(["a", "b"]);
  });
  it("drops non-strings, blanks, multi-line and over-long entries", () => {
    expect(readAvoidList(["a", 3, "  ", "x\ny", "z".repeat(MAX_AVOID_CHARS + 1)])).toEqual(["a"]);
  });
  it("deduplicates ignoring case, keeping the first spelling", () => {
    expect(readAvoidList(["Broker", "broker"])).toEqual(["Broker"]);
  });
  it("caps the count", () => {
    const many = Array.from({ length: MAX_AVOID_PER_TERM + 5 }, (_, i) => `w${i}`);
    expect(readAvoidList(many)).toHaveLength(MAX_AVOID_PER_TERM);
  });
  it("is empty for anything else", () => {
    expect(readAvoidList({ a: 1 })).toEqual([]);
    expect(readAvoidList(undefined)).toEqual([]);
  });
});

describe("readTermRule", () => {
  it("reads the term, the list, the language and who wrote the definition", () => {
    expect(
      readTermRule(
        note({ type: "term", language: "DE", source: "model", [TERM_AVOID_KEY]: ["cartel law"] })
      )
    ).toEqual({
      path: "Glossar/Terms/Kartellrecht.md",
      term: "Kartellrecht",
      avoid: ["cartel law"],
      language: "de",
      byModel: true
    });
  });
  it("prefers the term property over the file name", () => {
    expect(readTermRule(note({ term: "C#" }, "C"))?.term).toBe("C#");
  });
  it("never avoids the term itself", () => {
    expect(readTermRule(note({ [TERM_AVOID_KEY]: ["kartellrecht", "x"] }))?.avoid).toEqual(["x"]);
  });
  it("ignores a language that is not a code", () => {
    expect(readTermRule(note({ language: "Deutsch" }))?.language).toBeNull();
  });
  it("is null for a person", () => {
    expect(readTermRule(note({ type: "person" }))).toBeNull();
  });
});

describe("addAvoid", () => {
  it("appends a word", () => {
    expect(addAvoid(["a"], " b ", "T")).toEqual({ list: ["a", "b"] });
  });
  it("refuses, and says why", () => {
    expect(addAvoid([], "  ", "T")).toEqual({ error: "empty" });
    expect(addAvoid([], "t", "T")).toEqual({ error: "same" });
    expect(addAvoid(["A"], "a", "T")).toEqual({ error: "duplicate" });
    expect(addAvoid([], "x".repeat(MAX_AVOID_CHARS + 1), "T")).toEqual({ error: "tooLong" });
    expect(addAvoid([], "a\nb", "T")).toEqual({ error: "multiline" });
    const full = Array.from({ length: MAX_AVOID_PER_TERM }, (_, i) => `w${i}`);
    expect(addAvoid(full, "new", "T")).toEqual({ error: "tooMany" });
  });
  it("starts from a cleaned list when the stored one is malformed", () => {
    expect(addAvoid("a, a", "b", "T")).toEqual({ list: ["a", "b"] });
  });
});

describe("removeAvoid", () => {
  it("removes a word ignoring case", () => {
    expect(removeAvoid(["Broker", "Makler"], "broker")).toEqual(["Makler"]);
  });
});

describe("definitionExcerpt", () => {
  it("reads the definition of a Pythia note, not its quotes or discussion", () => {
    expect(definitionExcerpt(PYTHIA_NOTE)).toBe(
      "Das Recht gegen Absprachen und Marktmacht, die den Wettbewerb beschränken."
    );
  });
  it("skips a leading quote or heading", () => {
    expect(definitionExcerpt("> quote\n\n# H\n\nThe text\nwraps.")).toBe("The text wraps.");
  });
  it("caps a long definition", () => {
    const out = definitionExcerpt("w ".repeat(400));
    expect(out.length).toBeLessThanOrEqual(MAX_DEFINITION_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });
  it("is empty for an empty body", () => {
    expect(definitionExcerpt("---\ntype: term\n---\n")).toBe("");
  });
});

describe("buildTermFolderGlossaries", () => {
  const rule = (over: Partial<Parameters<typeof buildTermFolderGlossaries>[1][number]> = {}) => ({
    path: "Glossar/Terms/Kartellrecht.md",
    term: "Kartellrecht",
    avoid: ["cartel law"],
    language: "de",
    byModel: false,
    note: "Definition.",
    ...over
  });

  it("flags an avoided word, inflected, and offers the term", () => {
    const matcher = compileGlossaries(
      buildTermFolderGlossaries("Glossar", [rule({ avoid: ["Broker"] })])
    );
    const [hit] = matcher.findHits("Die Brokern sagen.");
    expect(hit?.replacement).toBe("Kartellrecht");
    expect(hit?.inflected).toBe(true);
    expect(hit?.note).toBe("Definition.");
  });

  it("never flags the preferred term, whatever its case", () => {
    const matcher = compileGlossaries(buildTermFolderGlossaries("Glossar", [rule()]));
    expect(matcher.findHits("kartellrecht und Kartellrecht")).toEqual([]);
  });

  it("checks nothing for a term with no list", () => {
    expect(buildTermFolderGlossaries("Glossar", [rule({ avoid: [] })])).toEqual([]);
  });

  it("splits by language, falling back to the default", () => {
    const glossaries = buildTermFolderGlossaries(
      "Glossar",
      [rule(), rule({ path: "b", language: "en" }), rule({ path: "c", language: null })],
      "de"
    );
    expect(glossaries.map((g) => [g.language, g.concepts.length])).toEqual([
      ["de", 2],
      ["en", 1]
    ]);
    expect(glossaries.every((g) => g.path === "Glossar")).toBe(true);
  });

  it("hands the proofread pass the rule as a constraint", () => {
    const matcher = compileGlossaries(buildTermFolderGlossaries("Glossar", [rule()]));
    expect(matcher.constraints()).toEqual([
      { avoid: "cartel law", use: "Kartellrecht", note: "Definition." }
    ]);
  });
});
