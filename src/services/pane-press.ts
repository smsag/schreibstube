/**
 * Whether the pane scrolls to a note that just became active.
 *
 * The pane follows the open note: open one by any route and its row in the
 * tree comes into view. But the pane has rows of its own above the tree — the
 * pinned ones, the recent lists, the bookmarks — and a note pressed there is
 * already in front of the person. Scrolling the tree to the same note then
 * scrolls the pane away from the row they pressed, which is a jump, not an
 * answer to "where am I".
 *
 * So a press in the pane's own lists is noted, and the file-open that follows
 * it opens the note's folders as ever but leaves the scroll alone. The note
 * is remembered by path where the press knows it; a bookmark resolves its
 * note only when opened, so it notes a press without one, and the next
 * file-open is taken to be it. Either way the note is a short-lived thing:
 * a press that opened nothing — a missing note, a folder — must not swallow
 * the scroll of a note opened by a link a minute later.
 */

/** How long a press in the pane can be waiting for its file-open. */
export const PANE_PRESS_WINDOW_MS = 1000;

export interface PanePress {
  /** The note pressed, or null when the press could not say. */
  path: string | null;
  at: number;
}

export function scrollsToOpenedNote(path: string, press: PanePress | null, now: number): boolean {
  if (press === null) return true;
  if (now - press.at > PANE_PRESS_WINDOW_MS) return true;
  return press.path !== null && press.path !== path;
}
