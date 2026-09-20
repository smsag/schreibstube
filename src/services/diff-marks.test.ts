import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diffParts } from "./diff-marks";

/** What the panel would render, as one string, to prove nothing is lost. */
const rebuilt = (text: string): string =>
  diffParts(text)
    .map((part) => part.text)
    .join("");

const marked = (text: string): string[] =>
  diffParts(text)
    .filter((part) => part.marked)
    .map((part) => part.text);

describe("diffParts", () => {
  it("returns a single-line segment whole and marked", () => {
    expect(diffParts("der blaue Wagen")).toEqual([{ text: "der blaue Wagen", marked: true }]);
  });

  it("keeps a lone space marked — it is part of the change", () => {
    // Dropping the mark here would break the stroke between two changed words.
    expect(diffParts(" ")).toEqual([{ text: " ", marked: true }]);
  });

  it("leaves a blank line between paragraphs unmarked", () => {
    expect(marked("erste Zeile\n\nzweite Zeile")).toEqual(["erste Zeile", "zweite Zeile"]);
  });

  it("treats a whitespace-only line as blank", () => {
    expect(marked("eins\n   \nzwei")).toEqual(["eins", "zwei"]);
  });

  it("never loses a character, so the text still reads as written", () => {
    for (const text of [
      "erste Zeile\n\nzweite Zeile",
      "eins\n   \nzwei",
      "\n\nnur Leerzeilen davor",
      "danach\n\n",
      "a\nb\nc",
      " ",
      ""
    ]) {
      expect(rebuilt(text), `rebuilding ${JSON.stringify(text)}`).toBe(text);
    }
  });

  it("marks nothing when every line is blank", () => {
    expect(marked("\n\n")).toEqual([]);
  });
});

/**
 * The panel has no render harness and the Obsidian stub has no `createSpan`,
 * so the wiring is checked at the source. What this catches is the exact
 * regression: a changed segment drawn as ONE span again, which is what put a
 * mark on the blank lines in the first place.
 */
describe("the review panel draws a changed segment through diffParts", () => {
  const source = readFileSync(new URL("../ui/review-panel.ts", import.meta.url), "utf8");

  it("imports it", () => {
    expect(source).toContain('import { diffParts } from "../services/diff-marks"');
  });

  it("never builds a diff mark straight from the segment's text", () => {
    for (const cls of ["schreibstube-diff-insert", "schreibstube-diff-delete"]) {
      const whole = new RegExp(`cls: "${cls}",\\s*text: segment\\.text`);
      expect(source, `${cls} is drawn as one span over the whole segment`).not.toMatch(whole);
    }
    expect(source).toMatch(/for \(const part of diffParts\(segment\.text\)\)/);
  });
});
