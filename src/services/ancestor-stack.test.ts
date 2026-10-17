import { describe, expect, it } from "vitest";
import { resolveAncestorStack, resolveStackUnderOverlay } from "./ancestor-stack";
import type { HeadingIndex } from "../types";

const index: HeadingIndex = [
  { level: 1, text: "A", lineNumber: 0 },
  { level: 2, text: "A.1", lineNumber: 3 },
  { level: 3, text: "A.1.a", lineNumber: 5 },
  { level: 2, text: "A.2", lineNumber: 10 },
  { level: 3, text: "A.2.a", lineNumber: 12 },
  { level: 1, text: "B", lineNumber: 20 },
  { level: 2, text: "B.1", lineNumber: 24 }
];

describe("resolveAncestorStack", () => {
  it("returns empty before the first heading", () => {
    const preHeadingIndex: HeadingIndex = [
      { level: 1, text: "Intro", lineNumber: 2 },
      { level: 2, text: "Intro Child", lineNumber: 5 }
    ];

    expect(resolveAncestorStack(preHeadingIndex, 0)).toEqual([]);
  });

  it("tracks latest heading at each active level", () => {
    expect(resolveAncestorStack(index, 13)).toEqual([
      { level: 1, text: "A", lineNumber: 0 },
      { level: 2, text: "A.2", lineNumber: 10 },
      { level: 3, text: "A.2.a", lineNumber: 12 }
    ]);
  });

  it("includes the heading that reaches the top edge", () => {
    expect(resolveAncestorStack(index, 10)).toEqual([
      { level: 1, text: "A", lineNumber: 0 },
      { level: 2, text: "A.2", lineNumber: 10 }
    ]);
  });

  it("resets deeper levels after shallower heading", () => {
    expect(resolveAncestorStack(index, 21)).toEqual([{ level: 1, text: "B", lineNumber: 20 }]);
  });

  it("handles gap headings without placeholder levels", () => {
    const gapIndex: HeadingIndex = [
      { level: 2, text: "Orphan", lineNumber: 2 },
      { level: 4, text: "Deep", lineNumber: 6 }
    ];

    expect(resolveAncestorStack(gapIndex, 7)).toEqual([
      { level: 2, text: "Orphan", lineNumber: 2 },
      { level: 4, text: "Deep", lineNumber: 6 }
    ]);
  });
});

describe("resolveStackUnderOverlay", () => {
  // Line under an overlay of d rows: two lines per row, from top line `top`.
  const edgeLines = (top: number): number[] =>
    Array.from({ length: 7 }, (_, depth) => top + depth * 2);

  it("shows nothing before the first heading, when nothing covers the text", () => {
    const late: HeadingIndex = [{ level: 1, text: "Late", lineNumber: 40 }];
    expect(resolveStackUnderOverlay(late, edgeLines(0))).toEqual([]);
  });

  it("agrees with the plain stack inside a section", () => {
    expect(resolveStackUnderOverlay(index, edgeLines(12))).toEqual(resolveAncestorStack(index, 12));
  });

  it("takes a shallow heading that a deep overlay would cover, not the section above it", () => {
    // Top line 17: one row reaches line 19 (still A.2.a, three deep); three
    // rows reach line 23, past B. Measured under its own height, neither
    // answer holds; B is the one that leaves no heading hidden.
    expect(resolveStackUnderOverlay(index, edgeLines(17))).toEqual([
      { level: 1, text: "B", lineNumber: 20 }
    ]);
  });

  it("lets a heading under a shallow overlay become current a row early, not hide", () => {
    // Top line 6: A.1.a is three deep, and so is everything one row down; two
    // rows reach line 10, A.2, which a two-row overlay covers and so shows.
    expect(resolveStackUnderOverlay(index, edgeLines(6))).toEqual([
      { level: 1, text: "A", lineNumber: 0 },
      { level: 2, text: "A.2", lineNumber: 10 }
    ]);
  });

  it("falls back to the deepest measurement when every depth disagrees", () => {
    expect(resolveStackUnderOverlay(index, [12, 12])).toEqual(resolveAncestorStack(index, 12));
  });
});
