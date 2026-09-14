import { describe, expect, it } from "vitest";
import { bodyStartIndex, foldTransitions, taskBodyRange } from "./task-fold";
import { listTasks } from "./task-summary";

describe("listTasks", () => {
  it("lists every task with its line and state", () => {
    const content = ["# H", "- [ ] a", "text", "  - [x] b", "```", "- [ ] fenced", "```"].join(
      "\n"
    );
    expect(listTasks(content)).toEqual([
      { line: 1, open: true },
      { line: 3, open: false }
    ]);
  });
});

describe("foldTransitions", () => {
  it("folds a task that was just ticked and unfolds one just unticked", () => {
    const before = new Map([
      [0, true],
      [3, false]
    ]);
    const after = [
      { line: 0, open: false },
      { line: 3, open: true }
    ];
    expect(foldTransitions(before, after)).toEqual({ fold: [0], unfold: [3] });
  });

  it("leaves a task alone when its state did not change", () => {
    const before = new Map([
      [0, true],
      [1, false]
    ]);
    const after = [
      { line: 0, open: true },
      { line: 1, open: false }
    ];
    expect(foldTransitions(before, after)).toEqual({ fold: [], unfold: [] });
  });

  it("folds a done task that is new to the document, and ignores a new open one", () => {
    const after = [
      { line: 2, open: false },
      { line: 5, open: true }
    ];
    expect(foldTransitions(new Map(), after)).toEqual({ fold: [2], unfold: [] });
  });
});

describe("taskBodyRange", () => {
  it("returns the indented lines under a task, without trailing blanks", () => {
    const lines = ["- [ ] task", "    more", "", "    and more", "", "next paragraph"];
    expect(taskBodyRange(lines, 0)).toEqual({ start: 1, end: 3 });
  });

  it("returns null for a task with nothing under it", () => {
    expect(taskBodyRange(["- [ ] task", "- [ ] other"], 0)).toBeNull();
    expect(taskBodyRange(["- [ ] task", "", "paragraph"], 0)).toBeNull();
    expect(taskBodyRange(["- [ ] last"], 0)).toBeNull();
  });

  it("stops at the next item on the same level and includes sub-items", () => {
    const lines = ["- [ ] task", "  - [ ] sub", "    detail", "- [ ] sibling"];
    expect(taskBodyRange(lines, 0)).toEqual({ start: 1, end: 2 });
  });

  it("measures a nested task against its own indentation", () => {
    const lines = ["- [ ] outer", "  - [ ] inner", "      inner text", "  - [ ] inner two"];
    expect(taskBodyRange(lines, 1)).toEqual({ start: 2, end: 2 });
  });

  it("counts a tab as four columns", () => {
    const lines = ["- [ ] task", "\tbody", "- [ ] next"];
    expect(taskBodyRange(lines, 0)).toEqual({ start: 1, end: 1 });
  });
});

describe("bodyStartIndex", () => {
  it("starts the body at a line break in a tight item", () => {
    expect(bodyStartIndex(["INPUT", null, "BR", null])).toBe(2);
  });

  it("starts the body at the second block of a loose item", () => {
    expect(bodyStartIndex(["INPUT", "", "P", "", "P"])).toBe(4);
    expect(bodyStartIndex(["INPUT", null, "UL"])).toBe(2);
  });

  it("keeps inline elements on the first line", () => {
    expect(bodyStartIndex(["INPUT", null, "STRONG", null, "A"])).toBe(-1);
    expect(bodyStartIndex(["INPUT", null, "EM", "BR", null])).toBe(3);
  });

  it("returns -1 for an item with a single line", () => {
    expect(bodyStartIndex(["INPUT", null])).toBe(-1);
    expect(bodyStartIndex(["INPUT", "", "P", ""])).toBe(-1);
    expect(bodyStartIndex([])).toBe(-1);
  });

  it("works on the children of a paragraph as well", () => {
    expect(bodyStartIndex([null, "BR", null])).toBe(1);
    expect(bodyStartIndex([null, "CODE", null])).toBe(-1);
  });
});
