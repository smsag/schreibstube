import { describe, expect, it } from "vitest";
import { tallyTasks, taskCount } from "./task-count";

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

describe("taskCount", () => {
  it("leads with DONE, not open — the form is read as progress", () => {
    // The bug this replaced: seven untouched tasks were labelled `7 / 7`,
    // which every reader takes for finished.
    expect(taskCount({ open: 7, total: 7 })).toEqual({ done: 0, total: 7, complete: false });
    expect(taskCount({ open: 0, total: 7 })).toEqual({ done: 7, total: 7, complete: true });
    expect(taskCount({ open: 1, total: 7 })).toEqual({ done: 6, total: 7, complete: false });
  });

  it("stays right when the numbers are large", () => {
    expect(taskCount({ open: 112, total: 240 })).toEqual({
      done: 128,
      total: 240,
      complete: false
    });
  });

  it("shows nothing for a note with no tasks", () => {
    expect(taskCount({ open: 0, total: 0 })).toBeNull();
  });

  it("is complete only when nothing is open", () => {
    expect(taskCount({ open: 0, total: 1 })?.complete).toBe(true);
    expect(taskCount({ open: 1, total: 1 })?.complete).toBe(false);
  });
});
