import { describe, expect, it } from "vitest";
import { rowKeyAction } from "./explorer-keys";
import type { RowKey } from "./explorer-keys";

const press = (key: string, extra: Partial<RowKey> = {}): RowKey => ({
  key,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...extra
});

const file = { isFolder: false, isOpen: false };
const closedFolder = { isFolder: true, isOpen: false };
const openFolder = { isFolder: true, isOpen: true };

describe("rowKeyAction", () => {
  it("activates on Enter and Space, whatever the row is", () => {
    expect(rowKeyAction(press("Enter"), file)).toBe("activate");
    expect(rowKeyAction(press(" "), closedFolder)).toBe("activate");
  });

  it("walks the list with the vertical arrows and the ends with Home and End", () => {
    expect(rowKeyAction(press("ArrowDown"), file)).toBe("next");
    expect(rowKeyAction(press("ArrowUp"), file)).toBe("previous");
    expect(rowKeyAction(press("Home"), file)).toBe("first");
    expect(rowKeyAction(press("End"), file)).toBe("last");
  });

  it("opens a closed folder with Right, and steps into an open one", () => {
    expect(rowKeyAction(press("ArrowRight"), closedFolder)).toBe("expand");
    expect(rowKeyAction(press("ArrowRight"), openFolder)).toBe("next");
  });

  it("leaves Right alone on a file, so it keeps its meaning elsewhere", () => {
    expect(rowKeyAction(press("ArrowRight"), file)).toBeNull();
  });

  it("closes an open folder with Left, and climbs to the parent otherwise", () => {
    expect(rowKeyAction(press("ArrowLeft"), openFolder)).toBe("collapse");
    expect(rowKeyAction(press("ArrowLeft"), closedFolder)).toBe("parent");
    expect(rowKeyAction(press("ArrowLeft"), file)).toBe("parent");
  });

  it("deletes on Delete, and on ⌘⌫ but never a bare Backspace", () => {
    expect(rowKeyAction(press("Delete"), file)).toBe("delete");
    expect(rowKeyAction(press("Backspace", { metaKey: true }), file)).toBe("delete");
    expect(rowKeyAction(press("Backspace"), file)).toBeNull();
  });

  it("renames on F2", () => {
    expect(rowKeyAction(press("F2"), file)).toBe("rename");
  });

  it("opens the menu on the menu key and on Shift+F10, not on F10 alone", () => {
    expect(rowKeyAction(press("ContextMenu"), file)).toBe("menu");
    expect(rowKeyAction(press("F10", { shiftKey: true }), file)).toBe("menu");
    expect(rowKeyAction(press("F10"), file)).toBeNull();
  });

  it("grows the selection with ⇧-arrow instead of moving", () => {
    expect(rowKeyAction(press("ArrowDown", { shiftKey: true }), file)).toBe("extend-next");
    expect(rowKeyAction(press("ArrowUp", { shiftKey: true }), file)).toBe("extend-previous");
  });

  it("lets the selection go on Escape", () => {
    expect(rowKeyAction(press("Escape"), openFolder)).toBe("clear");
  });

  it("undoes on ⌘Z and on Ctrl+Z, but not on a plain z or on ⇧⌘Z", () => {
    expect(rowKeyAction(press("z", { metaKey: true }), file)).toBe("undo");
    expect(rowKeyAction(press("z", { ctrlKey: true }), file)).toBe("undo");
    expect(rowKeyAction(press("z"), file)).toBeNull();
    expect(rowKeyAction(press("z", { metaKey: true, shiftKey: true }), file)).toBeNull();
  });

  it("claims nothing else, so the sidebar keeps its own keys", () => {
    expect(rowKeyAction(press("Tab"), file)).toBeNull();
    expect(rowKeyAction(press("a"), file)).toBeNull();
  });
});
