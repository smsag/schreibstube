import { describe, expect, it } from "vitest";
import {
  reduceMouseLeaveCollapse,
  reduceOutsideTapCollapse,
  reduceOverlayRowEvent
} from "./overlay-interaction";
import type { HeadingLevel } from "../types";

const level2 = 2 as HeadingLevel;

describe("reduceOverlayRowEvent", () => {
  it("navigates directly for ancestor rows", () => {
    const result = reduceOverlayRowEvent(
      {},
      { lineNumber: 10, level: level2, kind: "ancestor", source: "click" },
      true
    );

    expect(result).toEqual({
      navigateToLine: 10,
      shouldRender: false
    });
  });

  it("navigates directly for any provided heading line", () => {
    const result = reduceOverlayRowEvent(
      {},
      { lineNumber: 25, level: level2, kind: "ancestor", source: "click" },
      false
    );

    expect(result).toEqual({
      navigateToLine: 25,
      shouldRender: false
    });
  });
});

describe("collapse reducers", () => {
  it("is a no-op for outside tap collapse in stack-only mode", () => {
    const result = reduceOutsideTapCollapse(
      {},
      true,
      false
    );

    expect(result).toEqual({
      navigateToLine: null,
      shouldRender: false
    });
  });

  it("is a no-op for mouse leave collapse in stack-only mode", () => {
    const result = reduceMouseLeaveCollapse(
      {},
      false
    );

    expect(result).toEqual({
      navigateToLine: null,
      shouldRender: false
    });
  });
});
