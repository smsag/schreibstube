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
 * Which bases do this is the base's own to say, in its file: a key at the
 * top of the `.base` YAML, beside its filters and views. Obsidian keeps a
 * key it does not know when it writes the file again after an edit in its
 * own interface, so the choice travels with the base — to another device,
 * into a copy, through a rename — and can be read and written by hand.
 *
 * Pure: the controller reports the press, the opening and the file's text,
 * and does what this says.
 */

/**
 * How long after a press in a base an opening still counts as its answer:
 * long enough for a phone to open a note, short enough that a note opened a
 * moment later some other way is not taken for it.
 */
export const BASE_PRESS_WINDOW_MS = 1500;

export interface OpenedNote {
  /** Whether the base pressed opens its notes for reading. */
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

/** The key at the top of a `.base` file that makes its notes open for reading. */
export const BASE_READING_KEY = "schreibstubeReadingView";

/** A base file larger than this is not read for the key: a base is a page of YAML. */
export const MAX_BASE_FILE_BYTES = 256 * 1024;

/**
 * Whether a base's parsed YAML asks for its notes to open for reading. Only
 * `true` does: the file is edited by hand as often as by Obsidian, and a
 * key that reads `yes` or `"true"` is not taken for an answer it may not be.
 */
export function readsForReading(config: unknown): boolean {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return false;
  return (config as Record<string, unknown>)[BASE_READING_KEY] === true;
}

const KEY_LINE = new RegExp(`^${BASE_READING_KEY}[ \\t]*:.*(?:\\r?\\n|$)`, "gm");

/**
 * The base file's text with the key set or taken away, and nothing else
 * touched: the line is removed wherever it stands at the top level, and,
 * to set it, written as the file's first line. Rewriting the YAML from a
 * parse would reorder the person's keys and drop their comments; Obsidian
 * itself puts the keys it does not know first when it saves.
 */
export function withReadingView(source: string, on: boolean): string {
  const without = source.replace(KEY_LINE, "");
  if (!on) return without;
  const newline = /\r\n/.test(source) ? "\r\n" : "\n";
  return `${BASE_READING_KEY}: true${newline}${without}`;
}
