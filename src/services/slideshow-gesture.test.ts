import { describe, expect, it } from "vitest";
import {
  claimsHorizontal,
  classifyTouch,
  SWIPE_THRESHOLD_PX,
  TAP_SLOP_PX
} from "./slideshow-gesture";

describe("classifyTouch", () => {
  it("calls a finger that barely moved a tap", () => {
    expect(classifyTouch(0, 0)).toBe("tap");
    expect(classifyTouch(TAP_SLOP_PX, -TAP_SLOP_PX)).toBe("tap");
  });

  it("turns the page against the direction of a long sideways travel", () => {
    expect(classifyTouch(-(SWIPE_THRESHOLD_PX + 1), 0)).toBe("next");
    expect(classifyTouch(SWIPE_THRESHOLD_PX + 1, 0)).toBe("previous");
  });

  it("needs the travel to pass the threshold, not merely reach it", () => {
    expect(classifyTouch(SWIPE_THRESHOLD_PX, 0)).toBe("none");
    expect(classifyTouch(-SWIPE_THRESHOLD_PX, 0)).toBe("none");
  });

  it("leaves a scroll with some sideways drift alone", () => {
    expect(classifyTouch(SWIPE_THRESHOLD_PX + 20, SWIPE_THRESHOLD_PX + 21)).toBe("none");
    expect(classifyTouch(0, 200)).toBe("none");
  });

  it("does not call a short move that is neither a tap nor a swipe anything", () => {
    expect(classifyTouch(TAP_SLOP_PX + 1, 0)).toBe("none");
    expect(classifyTouch(0, TAP_SLOP_PX + 1)).toBe("none");
  });
});

describe("claimsHorizontal", () => {
  it("claims a drag as soon as it is clearly sideways", () => {
    expect(claimsHorizontal(TAP_SLOP_PX + 1, 0)).toBe(true);
    expect(claimsHorizontal(-(TAP_SLOP_PX + 1), TAP_SLOP_PX)).toBe(true);
  });

  it("claims nothing within the tap slop", () => {
    expect(claimsHorizontal(TAP_SLOP_PX, 0)).toBe(false);
    expect(claimsHorizontal(0, 0)).toBe(false);
  });

  it("leaves a drag that is more down than across to the scroll", () => {
    expect(claimsHorizontal(TAP_SLOP_PX + 1, TAP_SLOP_PX + 1)).toBe(false);
    expect(claimsHorizontal(20, 60)).toBe(false);
  });
});
