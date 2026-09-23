/**
 * Which rows are selected, and what a click or a key does to that.
 *
 * A tree that can hold more than one row at a time needs the rules every
 * file manager shares — a plain click selects one, ⌘-click adds or removes
 * one, ⇧-click takes every row between the anchor and here, ⇧-arrow walks
 * that range one row at a time — and it needs them to be one function over
 * plain data, so the whole contract is a test and the view only draws.
 *
 * `order` is the rows as they are on screen, top to bottom. It is passed in
 * rather than kept, because the view already has it and it changes with every
 * fold; a copy here would be one more thing to keep in step.
 */

export interface SelectionState {
  selected: ReadonlySet<string>;
  /** Where a range starts: the row last clicked without Shift. */
  anchor: string | null;
  /** Where a range ends: the row the last ⇧-arrow moved to. */
  cursor: string | null;
}

export const EMPTY_SELECTION: SelectionState = {
  selected: new Set(),
  anchor: null,
  cursor: null
};

export interface ClickModifiers {
  shift: boolean;
  /** ⌘ on a Mac, Ctrl elsewhere: add this row, or take it away. */
  toggle: boolean;
}

/** Every path from one row to another, inclusive, whichever is higher. */
function rangeBetween(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) return b === -1 ? [] : [to];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return order.slice(lo, hi + 1);
}

/**
 * The selection after a click on `path`.
 *
 * A plain click selects that row alone — the click also opens the file or
 * folds the folder, which is the view's business, but the row it landed on
 * is now the one row selected, and the anchor a later ⇧-click ranges from.
 */
export function selectionAfterClick(
  state: SelectionState,
  path: string,
  modifiers: ClickModifiers,
  order: readonly string[]
): SelectionState {
  if (modifiers.toggle) {
    const selected = new Set(state.selected);
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    return { selected, anchor: path, cursor: path };
  }

  if (modifiers.shift) {
    const anchor = state.anchor ?? path;
    return { selected: new Set(rangeBetween(order, anchor, path)), anchor, cursor: path };
  }

  return { selected: new Set([path]), anchor: path, cursor: path };
}

/**
 * The selection after ⇧-arrow: the range from the anchor grows or shrinks by
 * one row. From nothing, it starts at `from`, the row holding the focus.
 */
export function selectionExtended(
  state: SelectionState,
  from: string,
  step: 1 | -1,
  order: readonly string[]
): SelectionState {
  const anchor = state.anchor ?? from;
  const cursorAt = order.indexOf(state.cursor ?? from);
  const nextAt = Math.min(order.length - 1, Math.max(0, cursorAt + step));
  const cursor = order[nextAt] ?? from;
  return { selected: new Set(rangeBetween(order, anchor, cursor)), anchor, cursor };
}

/**
 * Drop what is no longer there.
 *
 * A row deleted, moved or filtered out of view has no business staying
 * selected: a delete of "the selection" a moment later would reach for a
 * file that is not on screen.
 */
export function selectionPruned(
  state: SelectionState,
  exists: (path: string) => boolean
): SelectionState {
  const selected = new Set([...state.selected].filter(exists));
  if (selected.size === state.selected.size) return state;
  return {
    selected,
    anchor: state.anchor !== null && exists(state.anchor) ? state.anchor : null,
    cursor: state.cursor !== null && exists(state.cursor) ? state.cursor : null
  };
}

/** Whether a menu on `path` should act on the selection rather than the row. */
export function menuActsOnSelection(state: SelectionState, path: string): boolean {
  return state.selected.size > 1 && state.selected.has(path);
}
