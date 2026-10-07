// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { installObsidianDom } from "../testing/obsidian-dom";
import {
  clearKeptMarks,
  dropAt,
  keptOrder,
  keptSlotAt,
  markDropTarget,
  markKeptSlot,
  orderAfterDrop
} from "./explorer-drop";

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

/**
 * A pane with a pinned block and a tree, each row 30 pixels high and stacked
 * in the order given, so a test can point at a row's upper or lower part.
 */
function pane(rows: { path: string; cls: string; tree?: boolean }[]): HTMLElement {
  const root = document.createElement("div");
  const shelf = root.appendChild(document.createElement("div"));
  const tree = root.appendChild(document.createElement("div"));
  tree.className = "schreibstube-explorer-tree";
  rows.forEach(({ path, cls, tree: inTree = true }, i) => {
    const row = (inTree ? tree : shelf).appendChild(document.createElement("div"));
    row.className = `schreibstube-explorer-row ${cls}`;
    row.setAttribute("data-path", path);
    row.getBoundingClientRect = () => ({ top: i * 30, bottom: i * 30 + 30, height: 30 }) as DOMRect;
  });
  return root;
}

const marks = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll(".is-drop-before, .is-drop-after")).map(
    (row) =>
      `${row.getAttribute("data-path")} ${row.classList.contains("is-drop-before") ? "before" : "after"}`
  );

describe("the rows held at the top of a folder", () => {
  beforeAll(() => installObsidianDom());

  const root = (): HTMLElement =>
    pane([
      { path: "F/a.md", cls: "is-pinned" },
      { path: "F/Sub", cls: "is-pinned is-folder" },
      { path: "F/Sub/x.md", cls: "is-pinned" },
      { path: "F/c.md", cls: "is-pinned" },
      { path: "F/d.md", cls: "" },
      { path: "G/e.md", cls: "is-pinned" }
    ]);

  it("are the folder's own kept rows, in drawn order", () => {
    expect(keptOrder(root(), "F")).toEqual(["F/a.md", "F/Sub", "F/c.md"]);
    expect(keptOrder(root(), "")).toEqual([]);
  });

  it("take a drop on either half of a file row", () => {
    expect(keptSlotAt(root(), "F", 5)).toEqual({ path: "F/a.md", before: true });
    expect(keptSlotAt(root(), "F", 25)).toEqual({ path: "F/a.md", before: false });
  });

  it("leave a folder row's middle to the move into it", () => {
    expect(keptSlotAt(root(), "F", 35)).toEqual({ path: "F/Sub", before: true });
    expect(keptSlotAt(root(), "F", 45)).toBeNull();
    expect(keptSlotAt(root(), "F", 55)).toEqual({ path: "F/Sub", before: false });
  });

  it("are not a place for a row of another folder, nor are rows that are not kept", () => {
    expect(keptSlotAt(root(), "F", 75)).toBeNull();
    expect(keptSlotAt(root(), "F", 125)).toBeNull();
    expect(keptSlotAt(root(), "F", 155)).toBeNull();
    expect(keptSlotAt(root(), "F", 500)).toBeNull();
  });

  it("mark where the row would land, but not on itself", () => {
    const pane = root();
    expect(markKeptSlot(pane, "F", 95, "F/a.md")).toBe(true);
    expect(marks(pane)).toEqual(["F/c.md before"]);
    expect(markKeptSlot(pane, "F", 5, "F/a.md")).toBe(true);
    expect(marks(pane)).toEqual([]);
    expect(markKeptSlot(pane, "F", 45, "F/a.md")).toBe(false);
    markKeptSlot(pane, "F", 25, "F/c.md");
    clearKeptMarks(pane);
    expect(marks(pane)).toEqual([]);
  });
});

describe("the pinned block", () => {
  beforeAll(() => installObsidianDom());

  it("takes a drop on either half of any row, a folder's too", () => {
    const root = pane([
      { path: "a.md", cls: "is-pinned-entry", tree: false },
      { path: "Folder", cls: "is-pinned-entry is-folder", tree: false }
    ]);
    expect(dropAt(root, 40)).toEqual({ path: "Folder", before: true });
    markDropTarget(root, 50, "a.md");
    expect(marks(root)).toEqual(["Folder after"]);
  });
});
