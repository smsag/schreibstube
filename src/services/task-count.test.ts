import { describe, expect, it } from "vitest";
import { countsTasks, tallyTasks, taskCount } from "./task-count";

describe("tallyTasks", () => {
  it("counts tasks and the open ones among them, ignoring plain list items", () => {
    const items = [{ task: " " }, { task: "x" }, {}, { task: " " }, { task: "-" }, { task: "X" }];
    expect(tallyTasks(items)).toEqual({ open: 2, total: 5, progress: 0 });
  });

  it("has nothing to say about a note without list items", () => {
    expect(tallyTasks(undefined)).toEqual({ open: 0, total: 0, progress: 0 });
    expect(tallyTasks([])).toEqual({ open: 0, total: 0, progress: 0 });
    expect(tallyTasks([{}, {}])).toEqual({ open: 0, total: 0, progress: 0 });
  });

  it("counts a started task as open, and says so, and a theme's flag as open", () => {
    // Markdown knows [ ] and [x]; the slash is a theme's "in progress", and
    // every other mark is a flag on an open task, never a finished one.
    const items = [{ task: "/" }, { task: ">" }, { task: "x" }, { task: "-" }, { task: " " }];
    expect(tallyTasks(items)).toEqual({ open: 3, total: 5, progress: 1 });
  });
});

describe("taskCount", () => {
  it("leads with DONE, not open — the form is read as progress", () => {
    // The bug this replaced: seven untouched tasks were labelled `7 / 7`,
    // which every reader takes for finished.
    const plain = { progress: 0 };
    expect(taskCount({ open: 7, total: 7 })).toEqual({
      done: 0,
      total: 7,
      ...plain,
      complete: false
    });
    expect(taskCount({ open: 0, total: 7 })).toEqual({
      done: 7,
      total: 7,
      ...plain,
      complete: true
    });
    expect(taskCount({ open: 1, total: 7 })).toEqual({
      done: 6,
      total: 7,
      ...plain,
      complete: false
    });
    expect(taskCount({ open: 2, total: 7, progress: 1 })).toEqual({
      done: 5,
      total: 7,
      progress: 1,
      complete: false
    });
  });

  it("stays right when the numbers are large", () => {
    expect(taskCount({ open: 112, total: 240 })).toEqual({
      done: 128,
      total: 240,
      progress: 0,
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

describe("countsTasks", () => {
  it("leaves a note out only when it says false, as a value or as the word", () => {
    expect(countsTasks({ schreibstubeTaskCount: false })).toBe(false);
    expect(countsTasks({ schreibstubeTaskCount: "false" })).toBe(false);
  });

  it("counts a note that says nothing, says true, or carries something unreadable", () => {
    for (const frontmatter of [
      undefined,
      null,
      {},
      "text",
      { schreibstubeTaskCount: true },
      { schreibstubeTaskCount: "no" },
      { schreibstubeTaskCount: 0 }
    ]) {
      expect(countsTasks(frontmatter)).toBe(true);
    }
  });
});
