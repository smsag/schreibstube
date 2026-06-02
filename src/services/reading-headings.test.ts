import { describe, expect, it } from "vitest";
import {
  getRenderedHeadingIndexForSourceLine,
  resolveViewportLineFromRenderedHeadings
} from "./reading-headings";
import type { HeadingIndex } from "../types";

const headingIndex: HeadingIndex = [
  { level: 1, text: "A", lineNumber: 0 },
  { level: 2, text: "A.1", lineNumber: 5 },
  { level: 2, text: "A.2", lineNumber: 15 },
  { level: 1, text: "B", lineNumber: 30 }
];

describe("resolveViewportLineFromRenderedHeadings", () => {
  it("returns fallback when rendered headings are unavailable", () => {
    expect(resolveViewportLineFromRenderedHeadings(headingIndex, [], 100, 7)).toBe(7);
  });

  it("returns the closest heading line at or above scroll top", () => {
    const offsets = [20, 200, 400, 800];

    expect(resolveViewportLineFromRenderedHeadings(headingIndex, offsets, 0, 0)).toBe(0);
    expect(resolveViewportLineFromRenderedHeadings(headingIndex, offsets, 210, 0)).toBe(5);
    expect(resolveViewportLineFromRenderedHeadings(headingIndex, offsets, 450, 0)).toBe(15);
    expect(resolveViewportLineFromRenderedHeadings(headingIndex, offsets, 1200, 0)).toBe(30);
  });
});

describe("getRenderedHeadingIndexForSourceLine", () => {
  it("maps source line to rendered heading index", () => {
    expect(getRenderedHeadingIndexForSourceLine(headingIndex, 15)).toBe(2);
  });

  it("returns -1 when source line is not present", () => {
    expect(getRenderedHeadingIndexForSourceLine(headingIndex, 999)).toBe(-1);
  });
});
