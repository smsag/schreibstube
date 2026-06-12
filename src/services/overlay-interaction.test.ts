import { describe, expect, it } from "vitest";
import { reduceOverlayRowEvent } from "./overlay-interaction";
import type { HeadingLevel } from "../types";

const level2 = 2 as HeadingLevel;

describe("reduceOverlayRowEvent", () => {
  it("returns the line number of the clicked row", () => {
    expect(
      reduceOverlayRowEvent({ lineNumber: 10, level: level2, kind: "ancestor", source: "click" })
    ).toBe(10);
  });

  it("returns the correct line for a different row", () => {
    expect(
      reduceOverlayRowEvent({ lineNumber: 25, level: level2, kind: "ancestor", source: "click" })
    ).toBe(25);
  });
});
