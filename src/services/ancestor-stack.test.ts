import { describe, expect, it } from "vitest";
import { resolveAncestorStack, resolveSiblingHeadings } from "./ancestor-stack";
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
    expect(resolveAncestorStack(index, 0)).toEqual([]);
  });

  it("tracks latest heading at each active level", () => {
    expect(resolveAncestorStack(index, 13)).toEqual([
      { level: 1, text: "A", lineNumber: 0 },
      { level: 2, text: "A.2", lineNumber: 10 },
      { level: 3, text: "A.2.a", lineNumber: 12 }
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

describe("resolveSiblingHeadings", () => {
  it("returns siblings only from the same parent branch", () => {
    const stack = resolveAncestorStack(index, 13);
    expect(resolveSiblingHeadings(index, stack, 2)).toEqual([
      { level: 2, text: "A.1", lineNumber: 3 },
      { level: 2, text: "A.2", lineNumber: 10 }
    ]);
  });

  it("returns empty when level is not active in stack", () => {
    const stack = resolveAncestorStack(index, 21);
    expect(resolveSiblingHeadings(index, stack, 3)).toEqual([]);
  });
});
