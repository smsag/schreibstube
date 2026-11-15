import { describe, expect, it } from "vitest";
import { byCodeUnit, indentWidth } from "./text";

describe("indentWidth", () => {
  it("counts a space as one column and a tab as four, up to the first other character", () => {
    expect(indentWidth("- task")).toBe(0);
    expect(indentWidth("  \t- task")).toBe(6);
    expect(indentWidth("- a  b")).toBe(0);
    expect(indentWidth("   ")).toBe(3);
  });
});

describe("byCodeUnit", () => {
  it("orders by code unit, so uppercase precedes lowercase", () => {
    expect(["b", "B", "a"].sort(byCodeUnit)).toEqual(["B", "a", "b"]);
    expect(byCodeUnit("a", "a")).toBe(0);
  });
});
