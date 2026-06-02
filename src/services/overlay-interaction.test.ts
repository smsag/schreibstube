import { describe, expect, it } from "vitest";
import {
  reduceMouseLeaveCollapse,
  reduceOutsideTapCollapse,
  reduceOverlayRowEvent
} from "./overlay-interaction";
import type { HeadingLevel } from "../types";

const level2 = 2 as HeadingLevel;

describe("reduceOverlayRowEvent", () => {
  it("expands ancestor on desktop hover", () => {
    const result = reduceOverlayRowEvent(
      { expandedLevel: null },
      { lineNumber: 10, level: level2, kind: "ancestor", source: "hover" },
      false
    );

    expect(result).toEqual({
      nextExpandedLevel: 2,
      navigateToLine: null,
      shouldRender: true
    });
  });

  it("uses first tap to expand ancestor on touch", () => {
    const result = reduceOverlayRowEvent(
      { expandedLevel: null },
      { lineNumber: 10, level: level2, kind: "ancestor", source: "click" },
      true
    );

    expect(result).toEqual({
      nextExpandedLevel: 2,
      navigateToLine: null,
      shouldRender: true
    });
  });

  it("uses second tap to navigate ancestor on touch", () => {
    const result = reduceOverlayRowEvent(
      { expandedLevel: level2 },
      { lineNumber: 10, level: level2, kind: "ancestor", source: "click" },
      true
    );

    expect(result).toEqual({
      nextExpandedLevel: null,
      navigateToLine: 10,
      shouldRender: false
    });
  });

  it("navigates directly for sibling click", () => {
    const result = reduceOverlayRowEvent(
      { expandedLevel: level2 },
      { lineNumber: 25, level: level2, kind: "sibling", source: "click" },
      false
    );

    expect(result).toEqual({
      nextExpandedLevel: null,
      navigateToLine: 25,
      shouldRender: false
    });
  });
});

describe("collapse reducers", () => {
  it("collapses expanded overlay on touch outside tap", () => {
    const result = reduceOutsideTapCollapse(
      { expandedLevel: level2 },
      true,
      false
    );

    expect(result).toEqual({
      nextExpandedLevel: null,
      navigateToLine: null,
      shouldRender: true
    });
  });

  it("does not collapse on inside tap", () => {
    const result = reduceOutsideTapCollapse(
      { expandedLevel: level2 },
      true,
      true
    );

    expect(result).toEqual({
      nextExpandedLevel: 2,
      navigateToLine: null,
      shouldRender: false
    });
  });

  it("collapses on desktop mouse leave", () => {
    const result = reduceMouseLeaveCollapse(
      { expandedLevel: level2 },
      false
    );

    expect(result).toEqual({
      nextExpandedLevel: null,
      navigateToLine: null,
      shouldRender: true
    });
  });
});
