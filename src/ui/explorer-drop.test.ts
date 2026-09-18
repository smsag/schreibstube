import { describe, expect, it } from "vitest";
import { orderAfterDrop } from "./explorer-drop";

const order = ["a", "b", "c", "d"];

describe("orderAfterDrop", () => {
  it("puts the row before or after the one it landed on", () => {
    expect(orderAfterDrop(order, "d", { path: "b", before: true })).toEqual(["a", "d", "b", "c"]);
    expect(orderAfterDrop(order, "a", { path: "c", before: false })).toEqual(["b", "c", "a", "d"]);
  });

  it("is null when nothing would change", () => {
    expect(orderAfterDrop(order, "a", null)).toBeNull();
    expect(orderAfterDrop(order, "a", { path: "a", before: true })).toBeNull();
    // Landing on the upper half of the next row is where the row already is.
    expect(orderAfterDrop(order, "a", { path: "b", before: true })).toBeNull();
    expect(orderAfterDrop(order, "b", { path: "a", before: false })).toBeNull();
  });

  it("is null when the slot names a row that is not in the block", () => {
    expect(orderAfterDrop(order, "a", { path: "zz", before: true })).toBeNull();
  });

  it("leaves the given order untouched", () => {
    const frozen = Object.freeze(["x", "y"]);
    expect(orderAfterDrop(frozen, "x", { path: "y", before: false })).toEqual(["y", "x"]);
    expect(frozen).toEqual(["x", "y"]);
  });
});
