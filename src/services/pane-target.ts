/**
 * Where a press opens a note: in place, a new tab, a split or a new window.
 *
 * Obsidian reads the modifiers for us — Cmd/Ctrl for a tab, with Alt for a
 * split, with Alt and Shift for a window — and a middle click is a tab. The
 * pane follows that everywhere a press opens a note, except where a modifier
 * already means something else: in the tree, Cmd and Shift gather a
 * selection, so there only the split and window chords open.
 */

export type PaneTarget = false | "tab" | "split" | "window";

/** Obsidian's reading of a press, as a target. Anything else it may say is a tab. */
export function openTargetOf(mod: string | boolean): PaneTarget {
  if (mod === false) return false;
  if (mod === "tab" || mod === "split" || mod === "window") return mod;
  return "tab";
}

/**
 * What a press on a tree row does: open somewhere, or — `null` — gather a
 * selection. The window chord carries Shift, so it is read before Shift is
 * taken to mean a range.
 */
export function treeRowTarget(mod: PaneTarget, shift: boolean): PaneTarget | null {
  if (mod === "split" || mod === "window") return mod;
  if (mod !== false || shift) return null;
  return false;
}

/** A phone or a tablet opens no second window; there the chord asks for a tab. */
export function availableTarget(target: PaneTarget, windows: boolean): PaneTarget {
  return target === "window" && !windows ? "tab" : target;
}
