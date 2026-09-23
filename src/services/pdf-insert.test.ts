import { describe, expect, it } from "vitest";
import { composePassageInsert } from "./pdf-insert";
import type { PdfPassage } from "./pdf-passages";

const passage = (page: number, text: string, beginIndex = 0): PdfPassage => ({
  page,
  text,
  anchor: { page, selection: { beginIndex, beginOffset: 0, endIndex: beginIndex, endOffset: 9 } }
});

const mark = (p: PdfPassage): string => `[[Bericht.pdf#page=${p.page}|↗]]`;

describe("composePassageInsert", () => {
  it("puts the mark at the end of the passage, where a footnote mark sits", () => {
    expect(composePassageInsert([passage(12, "Der Rückgang beträgt 12 %.")], mark)).toBe(
      "Der Rückgang beträgt 12 %. [[Bericht.pdf#page=12|↗]]"
    );
  });

  it("separates passages by a blank line", () => {
    const out = composePassageInsert([passage(3, "Erstens."), passage(4, "Zweitens.")], mark);

    expect(out).toBe("Erstens. [[Bericht.pdf#page=3|↗]]\n\nZweitens. [[Bericht.pdf#page=4|↗]]");
  });

  it("restores document order, whatever order they were chosen in", () => {
    const out = composePassageInsert([passage(9, "Später."), passage(2, "Früher.")], mark);

    expect(out.indexOf("Früher.")).toBeLessThan(out.indexOf("Später."));
  });

  it("orders two passages from one page by where they sit on it", () => {
    const out = composePassageInsert([passage(5, "Unten.", 40), passage(5, "Oben.", 4)], mark);

    expect(out.indexOf("Oben.")).toBeLessThan(out.indexOf("Unten."));
  });

  it("quotes only when asked", () => {
    const passages = [passage(1, "Ein Satz.")];

    expect(composePassageInsert(passages, mark, { quote: true })).toBe(
      "> Ein Satz. [[Bericht.pdf#page=1|↗]]"
    );
    expect(composePassageInsert(passages, mark, { quote: false })).not.toContain(">");
  });

  it("answers with nothing when nothing was chosen", () => {
    expect(composePassageInsert([], mark)).toBe("");
  });
});
