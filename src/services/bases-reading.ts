/**
 * Whether a note that has just opened was opened from a base, and so opens
 * for reading.
 *
 * Obsidian's own layouts for Bases — table, cards, list — open the note a
 * row stands for, or a link in it, the way any link opens: in whatever mode
 * the person's default gives a note. A plugin cannot hand those layouts a
 * mode, and the event that says a note opened does not say from where. So a
 * press is noticed as it happens, inside a base or not, and the note that
 * opens right after a press in a base is taken to be its answer.
 *
 * Pure: the controller reports the press and the opening, and does what
 * this says.
 */

/**
 * How long after a press in a base an opening still counts as its answer:
 * long enough for a phone to open a note, short enough that a note opened a
 * moment later some other way is not taken for it.
 */
export const BASE_PRESS_WINDOW_MS = 1500;

export interface OpenedNote {
  /** The setting: notes from bases open for reading. */
  enabled: boolean;
  /** When the last press in a base was, or null when the last press was elsewhere. */
  pressedAt: number | null;
  now: number;
  /** The extension of the file that opened. */
  extension: string;
  /** The mode the note is shown in — `preview` is Reading view — or null when it is not shown as a note. */
  mode: string | null;
}

/** Whether to switch the note that just opened to Reading view. */
export function opensForReading(opened: OpenedNote): boolean {
  if (!opened.enabled || opened.pressedAt === null) return false;
  const since = opened.now - opened.pressedAt;
  if (since < 0 || since > BASE_PRESS_WINDOW_MS) return false;
  if (opened.extension.toLowerCase() !== "md") return false;
  return opened.mode !== null && opened.mode !== "preview";
}
