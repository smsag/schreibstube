import { describe, expect, it } from "vitest";
import { diffSequences } from "./lcs";

describe("diffSequences", () => {
  it("finds the common subsequence around an insertion", () => {
    expect(diffSequences(["a", "b", "c"], ["a", "x", "b", "c"], 100)).toEqual([
      { op: "equal", items: ["a"] },
      { op: "insert", items: ["x"] },
      { op: "equal", items: ["b", "c"] }
    ]);
  });

  it("degrades to a whole-block replacement above the item limit", () => {
    expect(diffSequences(["a", "b"], ["a", "c"], 1)).toEqual([
      { op: "delete", items: ["a", "b"] },
      { op: "insert", items: ["a", "c"] }
    ]);
  });

  it("counts a subsequence longer than a byte, at the line-diff limit", () => {
    // Thousands of shared lines: a cell that could only hold 255 would misplace the
    // change, and the equal run would come back split or short.
    const lines = Array.from({ length: 3999 }, (_, i) => `line ${i}`);
    const runs = diffSequences(lines, [...lines, "tail"], 4000);
    expect(runs).toEqual([
      { op: "equal", items: lines },
      { op: "insert", items: ["tail"] }
    ]);
  });

  it("never builds a table whose cells could overflow", () => {
    const many = Array.from({ length: 0x10000 }, (_, i) => i);
    const runs = diffSequences(many, many, 0x10000);
    expect(runs.map((run) => run.op)).toEqual(["delete", "insert"]);
  });
});
