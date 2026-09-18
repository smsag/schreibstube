import { describe, expect, it } from "vitest";
import { compileGlossaries } from "./glossary-matcher";
import { parseGlossary, type Glossary } from "./glossary-parser";
import { segmentMarkdown } from "./markdown-segments";

function glossary(
  rows: string,
  frontmatter = "language: de\nschreibstubeDefaultSeverity: error"
): Glossary {
  const note = `---\nschreibstubeGlossary: true\n${frontmatter}\n---\n\n| Concept | Term | Status | Match | Note |\n|---|---|---|---|---|\n${rows}`;
  const { glossary: parsed, errors } = parseGlossary("Glossar.md", note);
  expect(errors).toEqual([]);
  return parsed;
}

const HAUS = glossary(
  [
    "| objekt | Objekt | preferred | word | |",
    "| objekt | Immobilie | deprecated | word | Hausbegriff |",
    "| objekt | Liegenschaft | admitted | | |",
    "| makler | Broker | deprecated | word | |",
    "| courtage | Courtage | superseded | word | Vertrag prüfen |"
  ].join("\n")
);

describe("compileGlossaries", () => {
  it("proposes the preferred term for a deprecated one", () => {
    const [hit] = compileGlossaries([HAUS]).findHits("Die Immobilie ist frei.");
    expect(hit?.matchedText).toBe("Immobilie");
    expect(hit?.replacement).toBe("Objekt");
    expect(hit?.kind).toBe("substitution");
    expect(hit?.severity).toBe("error");
    expect(hit?.note).toBe("Hausbegriff");
  });

  it("reports offsets that slice back to the matched text", () => {
    const text = "Die Immobilie ist frei.";
    const [hit] = compileGlossaries([HAUS]).findHits(text);
    expect(text.slice(hit?.from, hit?.to)).toBe(hit?.matchedText);
  });

  it("flags a deprecated term with no preferred term and offers no fix", () => {
    const [hit] = compileGlossaries([HAUS]).findHits("Der Broker ruft an.");
    expect(hit?.kind).toBe("existence");
    expect(hit?.replacement).toBe(null);
  });

  it("never auto-fixes a superseded term", () => {
    const [hit] = compileGlossaries([HAUS]).findHits("Die Courtage betraegt 3%.");
    expect(hit?.status).toBe("superseded");
    expect(hit?.replacement).toBe(null);
    expect(hit?.severity).toBe("warning");
  });

  it("never flags an admitted term", () => {
    expect(compileGlossaries([HAUS]).findHits("Die Liegenschaft ist frei.")).toEqual([]);
  });

  it("matches German inflections and marks them", () => {
    const [hit] = compileGlossaries([HAUS]).findHits("Alle Immobilien sind frei.");
    expect(hit?.matchedText).toBe("Immobilien");
    expect(hit?.inflected).toBe(true);
    expect(hit?.replacement).toBe("Objekt");
  });

  it("leaves the base form unmarked as inflected", () => {
    const [hit] = compileGlossaries([HAUS]).findHits("Die Immobilie ist frei.");
    expect(hit?.inflected).toBe(false);
  });

  it("does not match inside a longer word in word mode", () => {
    expect(compileGlossaries([HAUS]).findHits("Immobilienmakler sind da.")).toEqual([]);
  });

  it("respects word edges around umlauts", () => {
    const g = glossary("| a | Buero | deprecated | word | |\n| a | Büro | preferred | word | |");
    expect(compileGlossaries([g]).findHits("Das Großraumbuero ist voll.")).toEqual([]);
  });

  it("matches inside a compound in prefix mode", () => {
    const g = glossary(
      "| a | Broker | deprecated | prefix | |\n| a | Makler | preferred | word | |"
    );
    const [hit] = compileGlossaries([g]).findHits("Das Brokerbuero ruft an.");
    expect(hit?.matchedText).toBe("Brokerbuero");
    expect(hit?.replacement).toBe("Makler");
  });

  it("is case sensitive in exact mode", () => {
    const g = glossary("| a | GmbH | preferred | exact | |\n| a | gmbh | deprecated | exact | |");
    const hits = compileGlossaries([g]).findHits("Die gmbh und die GmbH.");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toBe("gmbh");
  });

  it("flags a preferred term written in the wrong case", () => {
    const [hit] = compileGlossaries([HAUS]).findHits("Das objekt ist frei.");
    expect(hit?.kind).toBe("capitalization");
    expect(hit?.replacement).toBe("Objekt");
    expect(hit?.severity).toBe("suggestion");
  });

  it("says nothing about a correctly written preferred term", () => {
    expect(compileGlossaries([HAUS]).findHits("Das Objekt ist frei.")).toEqual([]);
  });

  it("carries sentence-initial capitals onto the replacement", () => {
    const g = glossary(
      "| a | objekt | preferred | word | |\n| a | immobilie | deprecated | word | |"
    );
    const [hit] = compileGlossaries([g]).findHits("Immobilie frei.");
    expect(hit?.replacement).toBe("Objekt");
  });

  it("carries an all-caps match onto the replacement", () => {
    const [hit] = compileGlossaries([HAUS]).findHits("BROKER meldet sich.");
    expect(hit?.matchedText).toBe("BROKER");
  });

  it("skips matches inside protected spans", () => {
    const { blocks } = segmentMarkdown("Die `Immobilie` bleibt, die Immobilie nicht.");
    const [block] = blocks;
    const hits = block ? compileGlossaries([HAUS]).findHits(block.text, block.protectedRanges) : [];
    expect(hits).toHaveLength(1);
    expect(block?.text.slice(hits[0]?.from, hits[0]?.to)).toBe("Immobilie");
    expect(hits[0]?.from).toBeGreaterThan(20);
  });

  it("returns hits in document order", () => {
    const hits = compileGlossaries([HAUS]).findHits("Der Broker und die Immobilie.");
    expect(hits.map((h) => h.matchedText)).toEqual(["Broker", "Immobilie"]);
  });

  it("gives one card per span when two glossaries overlap", () => {
    const first = glossary(
      "| a | Immobilie | deprecated | word | |\n| a | Objekt | preferred | word | |"
    );
    const second = parseGlossary(
      "Zweit.md",
      "| Concept | Term | Status |\n|---|---|---|\n| b | Immobilie | deprecated |\n| b | Liegenschaft | preferred |"
    ).glossary;
    const hits = compileGlossaries([first, second]).findHits("Die Immobilie.");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.replacement).toBe("Objekt");
    expect(hits[0]?.glossaryPath).toBe("Glossar.md");
  });

  it("prefers the longer term when two overlap in one glossary", () => {
    const g = glossary(
      [
        "| a | Makler | deprecated | word | |",
        "| a | Berater | preferred | word | |",
        "| b | Makler Buero | deprecated | word | |",
        "| b | Beratungsbuero | preferred | word | |"
      ].join("\n")
    );
    const hits = compileGlossaries([g]).findHits("Das Makler Buero ruft an.");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toBe("Makler Buero");
  });

  it("reports emptiness for a glossary with nothing checkable", () => {
    const g = glossary("| a | Liegenschaft | admitted | | |");
    expect(compileGlossaries([g]).isEmpty()).toBe(true);
  });

  it("lists constraints for the prompt without preferred terms", () => {
    const constraints = compileGlossaries([HAUS]).constraints();
    expect(constraints.map((c) => c.avoid)).toEqual(["Immobilie", "Broker", "Courtage"]);
    expect(constraints[0]?.use).toBe("Objekt");
    expect(constraints[1]?.use).toBe(null);
  });
});

describe("a language the frontmatter made up", () => {
  it("does not take a prototype key for a suffix list", () => {
    const made = glossary(
      "| objekt | Immobilie | deprecated | word | |\n",
      "language: constructor"
    );
    const matcher = compileGlossaries([made]);
    expect(() => matcher.findHits("Die Immobilie ist frei.")).not.toThrow();
    expect(matcher.findHits("Die Immobilie ist frei.")).toHaveLength(1);
  });
});
