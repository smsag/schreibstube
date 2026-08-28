import { describe, expect, it } from "vitest";
import { reduceOverlayRowEvent } from "./overlay-interaction";
import type { HeadingLevel } from "../types";

const level2 = 2 as HeadingLevel;

describe("reduceOverlayRowEvent", () => {
  it("returns the clicked row's line number", () => {
    expect(
      reduceOverlayRowEvent({
        lineNumber: 10,
        level: level2,
        kind: "ancestor",
        source: "click"
      })
    ).toBe(10);
  });
});
