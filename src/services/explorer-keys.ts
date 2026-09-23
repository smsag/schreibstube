/**
 * What a key does on a row of the tree.
 *
 * The rows were announced as a tree — `role="treeitem"` on every one — and
 * could not be reached by keyboard at all, which is a promise to a screen
 * reader that the pane then broke. This is the map from a key to what the row
 * should do, kept as a pure function so the whole keyboard contract is a test
 * rather than something to verify by tabbing through a vault.
 *
 * The bindings follow the tree pattern every desktop file manager and the
 * WAI-ARIA tree share, so nothing here has to be learned: arrows move and
 * fold, Enter opens, Delete deletes, F2 renames, and the menu key opens the
 * menu a right click would.
 */

export type RowKeyAction =
  /** Open a file, or fold a folder the other way. Enter and Space. */
  | "activate"
  /** Open a closed folder. */
  | "expand"
  /** Close an open folder. */
  | "collapse"
  /** Move to the row above or below, or to the ends of the list. */
  | "previous"
  | "next"
  | "first"
  | "last"
  /** Move to the folder holding this row. */
  | "parent"
  | "delete"
  | "rename"
  | "menu";

export interface RowKeyContext {
  isFolder: boolean;
  /** For a folder: whether it is showing its children. */
  isOpen: boolean;
}

/** The parts of a keyboard event the map reads. */
export interface RowKey {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * The action for a key on a row, or null when the key is not the pane's.
 *
 * Null matters as much as any action: a key the pane does not claim has to
 * keep doing what it did — scroll the sidebar, move focus out of the tree —
 * and a handler that swallowed every key would trap a keyboard in the pane.
 *
 * Right on an open folder moves down into it rather than doing nothing, and
 * Left on a closed folder or a file moves up to the parent; both are how the
 * tree pattern lets arrows alone walk the whole structure.
 */
export function rowKeyAction(key: RowKey, context: RowKeyContext): RowKeyAction | null {
  switch (key.key) {
    case "Enter":
    case " ":
      return "activate";
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "ArrowRight":
      if (!context.isFolder) return null;
      return context.isOpen ? "next" : "expand";
    case "ArrowLeft":
      return context.isFolder && context.isOpen ? "collapse" : "parent";
    case "Delete":
      return "delete";
    case "Backspace":
      // ⌘⌫ is how a Mac deletes from any list; a bare Backspace is not.
      return key.metaKey ? "delete" : null;
    case "F2":
      return "rename";
    case "ContextMenu":
      return "menu";
    case "F10":
      return key.shiftKey ? "menu" : null;
    default:
      return null;
  }
}
