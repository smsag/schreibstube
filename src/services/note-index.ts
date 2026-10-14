/**
 * The ```schreibstube-index``` block: the note's headings as a list, placed
 * wherever the block stands.
 *
 * What the block says — how deep the index reaches, whether it starts folded —
 * and which headings it lists are decided here, so the note, the print and the
 * site cannot disagree. The bridge reads the block by the same rules; the
 * examples in `contracts/index-cases.json` hold both sides to them.
 */
import type { HeadingIndex } from "../types";
import { scanHeadings } from "./heading-index";
import { fenceMarker } from "./markdown-fence";

export const NOTE_INDEX_LANGUAGE = "schreibstube-index";

export const DEFAULT_INDEX_DEPTH = 2;
export const MAX_INDEX_DEPTH = 6;

/**
 * Past this many entries an index is a second copy of the note, not a way
 * into it: it is replaced by a note saying how to make it short again. A
 * count rather than a stopwatch, so a note shows the same thing on a phone,
 * on a laptop, on paper and on the site.
 */
export const MAX_INDEX_ENTRIES = 150;

/**
 * How long the editor may spend finding the headings before it gives up and
 * says so. Nowhere near what a real note needs; it is there so a pasted
 * hundred-thousand-line log cannot hold the editor while someone types.
 */
export const INDEX_BUDGET_MS = 200;

/** The block holds two settings; anything past this is not an index block. */
const MAX_OPTION_LINES = 20;

const DEPTH_PATTERN = /^depth\s*:\s*(.*)$/i;
const COLLAPSED_PATTERN = /^collapsed\s*:\s*(.*)$/i;

export interface NoteIndexOptions {
  depth: number;
  collapsed: boolean;
  /**
   * The first line of the block, counted from one, that was not understood.
   * Its setting keeps the default, and the index still shows.
   */
  unreadableLine: number | null;
}

/**
 * Reads the block. A line it cannot read never costs the index: the setting
 * keeps its default and the line is named, so a typo shows next to the
 * result instead of in place of it.
 */
export function parseNoteIndexOptions(source: string): NoteIndexOptions {
  const options: NoteIndexOptions = {
    depth: DEFAULT_INDEX_DEPTH,
    collapsed: false,
    unreadableLine: null
  };
  const lines = source.split(/\r?\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;

    const understood = index < MAX_OPTION_LINES && readOption(line, options);
    if (!understood && options.unreadableLine === null) options.unreadableLine = index + 1;
  }
  return options;
}

function readOption(line: string, options: NoteIndexOptions): boolean {
  const depth = DEPTH_PATTERN.exec(line);
  if (depth) {
    const value = (depth[1] ?? "").trim();
    if (!/^\d$/.test(value)) return false;
    const level = Number(value);
    if (level < 1 || level > MAX_INDEX_DEPTH) return false;
    options.depth = level;
    return true;
  }

  const collapsed = COLLAPSED_PATTERN.exec(line);
  if (collapsed) {
    const value = (collapsed[1] ?? "").trim().toLowerCase();
    if (value !== "true" && value !== "false") return false;
    options.collapsed = value === "true";
    return true;
  }

  return false;
}

export interface NoteIndexEntry {
  text: string;
  /** Zero-based line of the heading in the note. */
  line: number;
  /** Steps in from the left: 0 for the shallowest heading shown. */
  indent: number;
}

export type NoteIndexPlan =
  | { kind: "entries"; entries: NoteIndexEntry[] }
  | { kind: "empty" }
  /** `fits` is the deepest depth that lists something within the limit, or null when none does. */
  | { kind: "too-long"; count: number; fits: number | null }
  | { kind: "too-slow" };

interface IndexHeading {
  level: number;
  text: string;
  lineNumber: number;
}

/**
 * The entries an index of `depth` shows, from headings in document order.
 *
 * The indent follows the outline, not the number of `#`: a note without a
 * level-one heading does not start every entry one step in, and a jump from
 * `##` to `####` is one step, as it reads.
 */
export function planNoteIndex(headings: readonly IndexHeading[], depth: number): NoteIndexPlan {
  const shown = headings.filter((heading) => heading.level <= depth);
  if (shown.length === 0) return { kind: "empty" };
  if (shown.length > MAX_INDEX_ENTRIES) {
    return { kind: "too-long", count: shown.length, fits: deepestThatFits(headings, depth) };
  }

  const open: number[] = [];
  const entries = shown.map((heading) => {
    while (open.length > 0 && (open[open.length - 1] ?? 0) >= heading.level) open.pop();
    const indent = open.length;
    open.push(heading.level);
    return { text: heading.text, line: heading.lineNumber, indent };
  });
  return { kind: "entries", entries };
}

function deepestThatFits(headings: readonly IndexHeading[], depth: number): number | null {
  for (let level = depth - 1; level >= 1; level -= 1) {
    // A depth that lists nothing is no advice; neither is one still too long.
    const count = headings.filter((heading) => heading.level <= level).length;
    if (count > 0 && count <= MAX_INDEX_ENTRIES) return level;
  }
  return null;
}

/**
 * The index of a whole note, giving up when `expired` says the time is up.
 * The headings are the note's own: frontmatter and fences are passed over,
 * and the block's own lines are a fence.
 */
export function buildNoteIndex(
  content: string,
  depth: number,
  expired: () => boolean
): NoteIndexPlan {
  const headings: HeadingIndex | null = scanHeadings(content, expired);
  if (headings === null) return { kind: "too-slow" };
  return planNoteIndex(headings, depth);
}

export interface LineEdit {
  /** Zero-based line where the replaced text starts, at its first character. */
  fromLine: number;
  /** Zero-based line where the replaced text ends, at its first character. */
  toLine: number;
  text: string;
}

/**
 * How to fold or unfold the index block between `lineStart` and `lineEnd`,
 * the lines of its opening and closing fence: the body with its `collapsed:`
 * line set, or taken out when the index opens, since open is the default and
 * a setting that says nothing is clutter. Null when those lines are no longer
 * an index block — the note changed under the click — so nothing is written.
 */
export function collapseEdit(
  content: string,
  lineStart: number,
  lineEnd: number,
  collapsed: boolean
): LineEdit | null {
  const lines = content.split(/\r?\n/);
  const opening = lines[lineStart] ?? "";
  const marker = fenceMarker(opening);
  const language =
    opening
      .trim()
      .slice(marker?.length ?? 0)
      .trim()
      .split(/\s+/)[0] ?? "";
  if (marker === null || language.toLowerCase() !== NOTE_INDEX_LANGUAGE) return null;

  const closing = fenceMarker(lines[lineEnd] ?? "");
  if (lineEnd <= lineStart || closing === null || closing[0] !== marker[0]) return null;
  if (closing.length < marker.length || (lines[lineEnd] ?? "").trim() !== closing) return null;

  const body = lines
    .slice(lineStart + 1, lineEnd)
    .filter((line) => !COLLAPSED_PATTERN.test(line.trim()));
  if (collapsed) body.push("collapsed: true");

  const text = body.map((line) => `${line}\n`).join("");
  return { fromLine: lineStart + 1, toLine: lineEnd, text };
}

/** The note with `edit` made, in the note's own line endings. */
export function applyLineEdit(content: string, edit: LineEdit): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const inserted = edit.text === "" ? [] : edit.text.replace(/\n$/, "").split("\n");
  return [...lines.slice(0, edit.fromLine), ...inserted, ...lines.slice(edit.toLine)].join(eol);
}
