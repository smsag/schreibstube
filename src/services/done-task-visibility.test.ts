import { describe, expect, it } from "vitest";
import {
  DEFAULT_DONE_TASK_VISIBILITY,
  effectiveVisibility,
  finishedTaskRanges,
  hidesWithBody,
  isFinishedMark,
  mergeAdjacentRanges,
  normalizeDoneTaskVisibility,
  normalizeHideDoneTasks,
  rangesAwayFrom
} from "./done-task-visibility";

const note = (...lines: string[]): string => lines.join("\n");

describe("normalizeDoneTaskVisibility", () => {
  it("keeps the three values", () => {
    expect(normalizeDoneTaskVisibility("off")).toBe("off");
    expect(normalizeDoneTaskVisibility("dim")).toBe("dim");
    expect(normalizeDoneTaskVisibility("hide")).toBe("hide");
  });

  it("falls back to off for anything a hand-edited data file can hold", () => {
    expect(DEFAULT_DONE_TASK_VISIBILITY).toBe("off");
    for (const value of [undefined, null, "", "Hide", true, 1, {}, ["hide"]]) {
      expect(normalizeDoneTaskVisibility(value)).toBe("off");
    }
  });
});

describe("normalizeHideDoneTasks", () => {
  it("reads the booleans and their string forms", () => {
    expect(normalizeHideDoneTasks({ schreibstubeHideDoneTasks: true })).toBe(true);
    expect(normalizeHideDoneTasks({ schreibstubeHideDoneTasks: false })).toBe(false);
    expect(normalizeHideDoneTasks({ schreibstubeHideDoneTasks: "true" })).toBe(true);
    expect(normalizeHideDoneTasks({ schreibstubeHideDoneTasks: "false" })).toBe(false);
  });

  it("says nothing for an absent key, another value, or no frontmatter", () => {
    expect(normalizeHideDoneTasks({})).toBeNull();
    expect(normalizeHideDoneTasks({ other: false })).toBeNull();
    for (const value of [null, "no", "FALSE", 0, 1, [], {}]) {
      expect(normalizeHideDoneTasks({ schreibstubeHideDoneTasks: value })).toBeNull();
    }
    expect(normalizeHideDoneTasks(null)).toBeNull();
    expect(normalizeHideDoneTasks(undefined)).toBeNull();
    expect(normalizeHideDoneTasks("schreibstubeHideDoneTasks: false")).toBeNull();
  });
});

describe("effectiveVisibility", () => {
  it("applies the setting unless the note says false", () => {
    for (const setting of ["off", "dim", "hide"] as const) {
      expect(effectiveVisibility(setting, null)).toBe(setting);
      expect(effectiveVisibility(setting, true)).toBe(setting);
      expect(effectiveVisibility(setting, false)).toBe("off");
    }
  });
});

describe("isFinishedMark and hidesWithBody", () => {
  it("counts done and cancelled as finished, every other mark as open", () => {
    for (const mark of ["x", "X", "-"]) expect(isFinishedMark(mark)).toBe(true);
    for (const mark of [" ", "", "/", "?", ">", "!"]) expect(isFinishedMark(mark)).toBe(false);
  });

  it("keeps a finished item that has open work nested anywhere under it", () => {
    expect(hidesWithBody("x", [])).toBe(true);
    expect(hidesWithBody("-", ["x", "X", "-"])).toBe(true);
    expect(hidesWithBody("x", ["x", " "])).toBe(false);
    expect(hidesWithBody("x", ["/"])).toBe(false);
    expect(hidesWithBody(" ", [])).toBe(false);
  });
});

describe("finishedTaskRanges", () => {
  it("finds done and cancelled tasks, and leaves every other mark", () => {
    const content = note(
      "- [ ] open",
      "- [x] done",
      "- [X] done too",
      "- [-] cancelled",
      "- [/] started",
      "- [?] question",
      "- [>] forwarded"
    );
    expect(finishedTaskRanges(content)).toEqual([
      { start: 1, end: 1 },
      { start: 2, end: 2 },
      { start: 3, end: 3 }
    ]);
  });

  it("takes a finished task with its notes and finished sub-tasks", () => {
    const content = note(
      "- [x] parent",
      "  a note under it",
      "  - [x] child",
      "    - [-] grandchild",
      "- [ ] next"
    );
    expect(finishedTaskRanges(content)).toEqual([{ start: 0, end: 3 }]);
  });

  it("keeps a finished task with an open task at any depth below it", () => {
    const content = note(
      "- [x] parent",
      "  note",
      "  - [x] child",
      "    - [ ] grandchild",
      "  - [x] sibling"
    );
    // The parent and the child stay for the grandchild's sake; the sibling
    // has nothing open under it and goes on its own.
    expect(finishedTaskRanges(content)).toEqual([{ start: 4, end: 4 }]);
  });

  it("treats a started sub-task as open work", () => {
    expect(finishedTaskRanges(note("- [x] parent", "\t- [/] started"))).toEqual([]);
  });

  it("does not let a following task at the same depth count as nested", () => {
    expect(finishedTaskRanges(note("- [x] done", "- [ ] open"))).toEqual([{ start: 0, end: 0 }]);
  });

  it("keeps blank lines inside a body and leaves the one after it", () => {
    const content = note("- [x] done", "", "  still its note", "", "Paragraph");
    expect(finishedTaskRanges(content)).toEqual([{ start: 0, end: 2 }]);
  });

  it("reads numbered and other bullet lists", () => {
    const content = note("1. [x] first", "2) [ ] second", "* [x] star", "+ [-] plus");
    expect(finishedTaskRanges(content)).toEqual([
      { start: 0, end: 0 },
      { start: 2, end: 2 },
      { start: 3, end: 3 }
    ]);
  });

  it("finds a finished sub-task under an open parent", () => {
    const content = note("- [ ] parent", "  - [x] child", "    detail", "  - [ ] other");
    expect(finishedTaskRanges(content)).toEqual([{ start: 1, end: 2 }]);
  });

  it("ignores tasks in fenced code and in the frontmatter", () => {
    const content = note(
      "---",
      "list:",
      "- [x] yaml",
      "---",
      "```",
      "- [x] code",
      "```",
      "- [x] real"
    );
    expect(finishedTaskRanges(content)).toEqual([{ start: 7, end: 7 }]);
  });

  it("reads a note that opens with an unclosed frontmatter line as text", () => {
    expect(finishedTaskRanges(note("---", "- [x] task"))).toEqual([{ start: 1, end: 1 }]);
  });

  it("reads Windows line endings", () => {
    expect(finishedTaskRanges("- [x] a\r\n  note\r\n- [ ] b")).toEqual([{ start: 0, end: 1 }]);
  });

  it("finds nothing in a note without tasks", () => {
    expect(finishedTaskRanges("")).toEqual([]);
    expect(finishedTaskRanges(note("# Heading", "- plain item", "text"))).toEqual([]);
  });
});

describe("rangesAwayFrom", () => {
  const ranges = [
    { start: 1, end: 3 },
    { start: 6, end: 6 },
    { start: 9, end: 12 }
  ];

  it("keeps every range when the selection is elsewhere", () => {
    expect(rangesAwayFrom(ranges, [{ start: 4, end: 5 }])).toEqual(ranges);
    expect(rangesAwayFrom(ranges, [])).toEqual(ranges);
  });

  it("drops the whole range the cursor is in, at its first, middle or last line", () => {
    expect(rangesAwayFrom(ranges, [{ start: 1, end: 1 }])).toEqual(ranges.slice(1));
    expect(rangesAwayFrom(ranges, [{ start: 10, end: 10 }])).toEqual(ranges.slice(0, 2));
    expect(rangesAwayFrom(ranges, [{ start: 3, end: 3 }])).toEqual(ranges.slice(1));
  });

  it("drops every range a selection reaches into, and each of several cursors", () => {
    expect(rangesAwayFrom(ranges, [{ start: 3, end: 9 }])).toEqual([]);
    expect(
      rangesAwayFrom(ranges, [
        { start: 6, end: 6 },
        { start: 0, end: 0 }
      ])
    ).toEqual([ranges[0], ranges[2]]);
  });
});

describe("mergeAdjacentRanges", () => {
  it("joins ranges with no line between them and keeps the others apart", () => {
    const ranges = [
      { start: 0, end: 1 },
      { start: 2, end: 2 },
      { start: 3, end: 5 },
      { start: 7, end: 7 }
    ];
    expect(mergeAdjacentRanges(ranges)).toEqual([
      { start: 0, end: 5 },
      { start: 7, end: 7 }
    ]);
    // The input is left as it was: the editor keeps it for the next redraw.
    expect(ranges[0]).toEqual({ start: 0, end: 1 });
    expect(mergeAdjacentRanges([])).toEqual([]);
  });
});
