import { describe, expect, it } from "vitest";
import { resolveAncestorStack } from "./ancestor-stack";
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
    expect(resolveAncestorStack(index, 21)).toEqual([
      { level: 1, text: "B", lineNumber: 20 }
    ]);
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
