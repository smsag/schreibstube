import { describe, expect, it } from "vitest";
import { KEYWORD_SCAN_CHARS, MAX_STATED_KEYWORDS, statedKeywords } from "./stated-keywords";

describe("statedKeywords", () => {
  it("reads a keywords key a reference manager wrote", () => {
    expect(statedKeywords({ Keywords: ["Optics", "Lasers", 3] }, "")).toEqual(["Optics", "Lasers"]);
    expect(statedKeywords({ schlagwörter: "Optik; Laser" }, "")).toEqual(["Optik", "Laser"]);
  });

  it("prefers the frontmatter and falls back to the text", () => {
    const text = "Keywords: a, b";
    expect(statedKeywords({ keywords: "x" }, text)).toEqual(["x"]);
    expect(statedKeywords({ keywords: [] }, text)).toEqual(["a", "b"]);
    expect(statedKeywords(null, text)).toEqual(["a", "b"]);
    expect(statedKeywords(["keywords"], text)).toEqual(["a", "b"]);
  });

  it("reads a keywords line under an abstract", () => {
    const text = [
      "# A paper",
      "",
      "Abstract. We study things.",
      "",
      "**Keywords:** machine learning; *neural networks*; [[Optik|optics]].",
      "",
      "## Introduction"
    ].join("\n");
    expect(statedKeywords(undefined, text)).toEqual([
      "machine learning",
      "neural networks",
      "optics"
    ]);
  });

  it("reads IEEE's index terms and Springer's middle dots", () => {
    expect(statedKeywords({}, "Index Terms—Lasers, optics, imaging")).toEqual([
      "Lasers",
      "optics",
      "imaging"
    ]);
    expect(statedKeywords({}, "Keywords Machine learning · Deep learning")).toEqual([
      "Machine learning",
      "Deep learning"
    ]);
  });

  it("reads the paragraph under a keywords heading, wrapped over lines", () => {
    const text = "---\ntitle: x\n---\n## Schlüsselwörter\n\nOptik, Laser,\nBildgebung\n\nText";
    expect(statedKeywords({}, text)).toEqual(["Optik", "Laser", "Bildgebung"]);
  });

  it("stops at the next heading or keyword line", () => {
    expect(statedKeywords({}, "Keywords:\n# Next\nnot this")).toEqual([]);
    expect(statedKeywords({}, "Keywords: a\nKeywords: b")).toEqual(["a"]);
  });

  it("does not take a sentence about keywords for keywords", () => {
    expect(statedKeywords({}, "Keywords are what a search engine reads, mostly.")).toEqual([]);
  });

  it("drops sentences, duplicates and anything past the limit", () => {
    const many = Array.from({ length: MAX_STATED_KEYWORDS + 5 }, (_, i) => `k${i}`).join(", ");
    expect(statedKeywords({}, `Keywords: ${many}`)).toHaveLength(MAX_STATED_KEYWORDS);
    expect(
      statedKeywords(
        {},
        "Keywords: one, One, this is a whole sentence and not a keyword at all, " +
          `${"x".repeat(61)}, two`
      )
    ).toEqual(["one", "two"]);
  });

  it("looks only near the top of the note", () => {
    const text = `${"x\n".repeat(KEYWORD_SCAN_CHARS)}Keywords: late`;
    expect(statedKeywords({}, text)).toEqual([]);
    expect(statedKeywords({}, 42 as unknown as string)).toEqual([]);
  });
});
