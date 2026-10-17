import type { HeadingEntry, HeadingIndex } from "../types";

/**
 * The note's headings as a tree, for the breadcrumb above a long note: the
 * sections beside the one being read, where it stands among them, and the
 * sections a step away.
 *
 * A heading's parent is the nearest heading before it of a lower level, so a
 * note that skips a level (`#` then `###`) still nests the way it reads.
 * Siblings share a parent, whatever their own level.
 */

function parentLines(index: HeadingIndex): Map<number, number | null> {
  const parents = new Map<number, number | null>();
  const open: HeadingEntry[] = [];
  for (const heading of index) {
    while (open.length > 0 && (open[open.length - 1]?.level ?? 0) >= heading.level) open.pop();
    parents.set(heading.lineNumber, open[open.length - 1]?.lineNumber ?? null);
    open.push(heading);
  }
  return parents;
}

/** The heading `entry` sits under, or null for a heading at the top of the note. */
export function parentOf(index: HeadingIndex, entry: HeadingEntry): HeadingEntry | null {
  const line = parentLines(index).get(entry.lineNumber);
  return line === undefined || line === null
    ? null
    : (index.find((heading) => heading.lineNumber === line) ?? null);
}

/** The headings that share `entry`'s parent, `entry` among them, in the note's order. */
export function siblingsOf(index: HeadingIndex, entry: HeadingEntry): HeadingEntry[] {
  const parents = parentLines(index);
  if (!parents.has(entry.lineNumber)) return [];
  const parent = parents.get(entry.lineNumber);
  return index.filter((heading) => parents.get(heading.lineNumber) === parent);
}

/** Where `entry` stands among its siblings, counted from 1, or null when it is not in the note. */
export function sectionPosition(
  index: HeadingIndex,
  entry: HeadingEntry
): { position: number; count: number } | null {
  const siblings = siblingsOf(index, entry);
  const at = siblings.findIndex((heading) => heading.lineNumber === entry.lineNumber);
  return at === -1 ? null : { position: at + 1, count: siblings.length };
}

/**
 * The section after the one being read and everything under it: the next
 * heading at its level or above. Before the first heading, the first one.
 */
export function nextSection(
  index: HeadingIndex,
  current: HeadingEntry | null
): HeadingEntry | null {
  if (!current) return index[0] ?? null;
  return (
    index.find(
      (heading) => heading.lineNumber > current.lineNumber && heading.level <= current.level
    ) ?? null
  );
}

/** The sibling before the section being read, or, for the first of them, the section it is in. */
export function previousSection(
  index: HeadingIndex,
  current: HeadingEntry | null
): HeadingEntry | null {
  if (!current) return null;
  const siblings = siblingsOf(index, current);
  const at = siblings.findIndex((heading) => heading.lineNumber === current.lineNumber);
  return (at > 0 ? siblings[at - 1] : undefined) ?? parentOf(index, current);
}

/**
 * Which crumbs of a path of `count` stand in one "…" when the path does not
 * fit: the second one first, then the ones after it, never the first (the
 * note's top section) or the last (the one being read).
 */
export function collapsedCrumbs(
  count: number,
  collapse: number
): { shown: number[]; hidden: number[] } {
  const hide = Math.max(0, Math.min(collapse, count - 2));
  const all = Array.from({ length: count }, (_, i) => i);
  return {
    shown: all.filter((i) => i === 0 || i > hide),
    hidden: all.filter((i) => i > 0 && i <= hide)
  };
}
