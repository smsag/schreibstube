import { describe, expect, it } from "vitest";
import { pagesToRelease, PREVIEW_KEEP_PAGES } from "./preview-pages";

describe("pagesToRelease", () => {
  it("lets nothing go while no more than the limit is drawn", () => {
    expect(pagesToRelease([1, 2, 3], new Set([2]), 3)).toEqual([]);
  });

  it("lets the pages farthest from the view go first", () => {
    expect(pagesToRelease([1, 2, 3, 10, 11], new Set([10, 11]), 3)).toEqual([1, 2]);
  });

  it("never lets a page near the view go, even past the limit", () => {
    expect(pagesToRelease([4, 5, 6, 7], new Set([4, 5, 6, 7]), 2)).toEqual([]);
    expect(pagesToRelease([1, 4, 5, 6], new Set([4, 5, 6]), 2)).toEqual([1]);
  });

  it("lets the earliest drawn go first among pages equally far", () => {
    expect(pagesToRelease([7, 3, 5], new Set([5]), 2)).toEqual([7]);
  });

  it("with nothing near, lets the earliest drawn go", () => {
    expect(pagesToRelease([3, 1, 2], new Set(), 1)).toEqual([3, 1]);
  });

  it("holds a handful of pages by default", () => {
    expect(PREVIEW_KEEP_PAGES).toBeGreaterThanOrEqual(4);
  });
});
