import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  menuActsOnSelection,
  selectionAfterClick,
  selectionExtended,
  selectionPruned
} from "./explorer-selection";
import type { SelectionState } from "./explorer-selection";

const order = ["A.md", "B.md", "C.md", "D.md", "E.md"];
const plain = { shift: false, toggle: false };
const shift = { shift: true, toggle: false };
const toggle = { shift: false, toggle: true };

const paths = (state: SelectionState): string[] => [...state.selected].sort();

describe("selectionAfterClick", () => {
  it("selects the clicked row alone on a plain click, and makes it the anchor", () => {
    const state = selectionAfterClick(EMPTY_SELECTION, "C.md", plain, order);

    expect(paths(state)).toEqual(["C.md"]);
    expect(state.anchor).toBe("C.md");
  });

  it("adds a row on ⌘-click, and takes it away again", () => {
    const one = selectionAfterClick(EMPTY_SELECTION, "A.md", plain, order);
    const two = selectionAfterClick(one, "D.md", toggle, order);
    expect(paths(two)).toEqual(["A.md", "D.md"]);

    const back = selectionAfterClick(two, "A.md", toggle, order);
    expect(paths(back)).toEqual(["D.md"]);
  });

  it("takes every row between the anchor and the ⇧-clicked row, either way up", () => {
    const anchored = selectionAfterClick(EMPTY_SELECTION, "B.md", plain, order);

    expect(paths(selectionAfterClick(anchored, "D.md", shift, order))).toEqual([
      "B.md",
      "C.md",
      "D.md"
    ]);
    expect(paths(selectionAfterClick(anchored, "A.md", shift, order))).toEqual(["A.md", "B.md"]);
  });

  it("keeps the anchor across ⇧-clicks, so the range can be resized", () => {
    const anchored = selectionAfterClick(EMPTY_SELECTION, "B.md", plain, order);
    const wide = selectionAfterClick(anchored, "E.md", shift, order);
    const narrow = selectionAfterClick(wide, "C.md", shift, order);

    expect(paths(narrow)).toEqual(["B.md", "C.md"]);
    expect(narrow.anchor).toBe("B.md");
  });

  it("starts a range from the clicked row when there is no anchor yet", () => {
    expect(paths(selectionAfterClick(EMPTY_SELECTION, "C.md", shift, order))).toEqual(["C.md"]);
  });

  it("replaces a ⌘-built selection on the next plain click", () => {
    const one = selectionAfterClick(EMPTY_SELECTION, "A.md", plain, order);
    const two = selectionAfterClick(one, "C.md", toggle, order);

    expect(paths(selectionAfterClick(two, "E.md", plain, order))).toEqual(["E.md"]);
  });
});

describe("selectionExtended", () => {
  it("grows the range one row at a time with ⇧-arrow", () => {
    const anchored = selectionAfterClick(EMPTY_SELECTION, "B.md", plain, order);
    const down = selectionExtended(anchored, "B.md", 1, order);
    const further = selectionExtended(down, "B.md", 1, order);

    expect(paths(down)).toEqual(["B.md", "C.md"]);
    expect(paths(further)).toEqual(["B.md", "C.md", "D.md"]);
  });

  it("shrinks the range when the arrow turns back toward the anchor", () => {
    const anchored = selectionAfterClick(EMPTY_SELECTION, "B.md", plain, order);
    const wide = selectionExtended(selectionExtended(anchored, "B.md", 1, order), "B.md", 1, order);
    const back = selectionExtended(wide, "B.md", -1, order);

    expect(paths(back)).toEqual(["B.md", "C.md"]);
  });

  it("starts from the focused row when nothing is selected", () => {
    expect(paths(selectionExtended(EMPTY_SELECTION, "D.md", -1, order))).toEqual(["C.md", "D.md"]);
  });

  it("stops at the ends of the list", () => {
    const atTop = selectionAfterClick(EMPTY_SELECTION, "A.md", plain, order);
    expect(paths(selectionExtended(atTop, "A.md", -1, order))).toEqual(["A.md"]);
  });
});

describe("selectionPruned", () => {
  it("drops rows that are gone, and the anchor with them", () => {
    const state: SelectionState = {
      selected: new Set(["A.md", "B.md"]),
      anchor: "A.md",
      cursor: "B.md"
    };

    const pruned = selectionPruned(state, (path) => path !== "A.md");

    expect(paths(pruned)).toEqual(["B.md"]);
    expect(pruned.anchor).toBeNull();
    expect(pruned.cursor).toBe("B.md");
  });

  it("hands back the same state when nothing changed, so a redraw costs nothing", () => {
    const state = selectionAfterClick(EMPTY_SELECTION, "A.md", plain, order);
    expect(selectionPruned(state, () => true)).toBe(state);
  });
});

describe("menuActsOnSelection", () => {
  it("only when more than one row is selected and the pressed row is among them", () => {
    const one = selectionAfterClick(EMPTY_SELECTION, "A.md", plain, order);
    const two = selectionAfterClick(one, "B.md", toggle, order);

    expect(menuActsOnSelection(one, "A.md")).toBe(false);
    expect(menuActsOnSelection(two, "A.md")).toBe(true);
    expect(menuActsOnSelection(two, "E.md")).toBe(false);
  });
});
