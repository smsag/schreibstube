import { describe, expect, it } from "vitest";
import {
  FALLBACK_OVERLAY_METRICS,
  MAX_STACK_DEPTH,
  measureOverlayMetrics,
  overlayHeightsByDepth
} from "./overlay-geometry";

describe("measureOverlayMetrics", () => {
  it("reads the row pitch and the chrome off an overlay of three rows", () => {
    // Rows of 20 with gaps of 4: a list of 68; padding and border add 13.
    expect(measureOverlayMetrics({ overlayHeight: 81, listHeight: 68, rows: 3, gap: 4 })).toEqual({
      chrome: 9,
      rowPitch: 24
    });
  });

  it("has nothing to measure on an overlay without rows or not laid out", () => {
    expect(measureOverlayMetrics({ overlayHeight: 0, listHeight: 0, rows: 0, gap: 4 })).toBeNull();
    expect(measureOverlayMetrics({ overlayHeight: 0, listHeight: 68, rows: 3, gap: 4 })).toBeNull();
  });
});

describe("overlayHeightsByDepth", () => {
  it("gives the height an overlay of each depth would take, the same as a drawn one", () => {
    const heights = overlayHeightsByDepth(FALLBACK_OVERLAY_METRICS);
    expect(heights).toHaveLength(MAX_STACK_DEPTH + 1);
    expect(heights.slice(0, 4)).toEqual([0, 33, 57, 81]);
  });

  it("never goes below zero, whatever was measured", () => {
    expect(overlayHeightsByDepth({ chrome: -100, rowPitch: 10 })[1]).toBe(0);
  });
});
