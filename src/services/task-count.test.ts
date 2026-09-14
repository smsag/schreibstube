import { describe, expect, it } from "vitest";
import { tallyTasks, taskCountLabel } from "./task-count";

describe("tallyTasks", () => {
  it("counts tasks and the open ones among them, ignoring plain list items", () => {
    const items = [{ task: " " }, { task: "x" }, {}, { task: " " }, { task: "-" }, { task: "X" }];
    expect(tallyTasks(items)).toEqual({ open: 2, total: 5 });
  });

  it("has nothing to say about a note without list items", () => {
    expect(tallyTasks(undefined)).toEqual({ open: 0, total: 0 });
    expect(tallyTasks([])).toEqual({ open: 0, total: 0 });
    expect(tallyTasks([{}, {}])).toEqual({ open: 0, total: 0 });
  });
});

describe("taskCountLabel", () => {
  it("shows open over total", () => {
    expect(taskCountLabel({ open: 1, total: 7 })).toBe("1 / 7");
    expect(taskCountLabel({ open: 0, total: 3 })).toBe("0 / 3");
  });

  it("shows nothing for a note with no tasks", () => {
    expect(taskCountLabel({ open: 0, total: 0 })).toBeNull();
  });
});
