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

/**
 * Each heading's parent line, built once per index: the breadcrumb asks on
 * every render, every menu and every command check, and the plugin keeps
 * the same index object for as long as the headings stay the same.
 */
const parentCache = new WeakMap<HeadingIndex, Map<number, number | null>>();

function parentLines(index: HeadingIndex): Map<number, number | null> {
  const cached = parentCache.get(index);
  if (cached) return cached;
  const parents = new Map<number, number | null>();
  const open: HeadingEntry[] = [];
  for (const heading of index) {
    while (open.length > 0 && (open[open.length - 1]?.level ?? 0) >= heading.level) open.pop();
    parents.set(heading.lineNumber, open[open.length - 1]?.lineNumber ?? null);
    open.push(heading);
  }
  parentCache.set(index, parents);
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
 * fit: the outermost first, then the ones after it, never the one being
 * read. The outermost is the one least worth its room — in a README the
 * project's name, which the note's title above already says — and the ones
 * nearest the section being read say most about where it is.
 */
export function collapsedCrumbs(
  count: number,
  collapse: number
): { shown: number[]; hidden: number[] } {
  const hide = Math.max(0, Math.min(collapse, count - 1));
  const all = Array.from({ length: count }, (_, i) => i);
  return { shown: all.slice(hide), hidden: all.slice(0, hide) };
}

/** Whether two indexes hold the same headings on the same lines. */
export function sameHeadings(a: HeadingIndex, b: HeadingIndex): boolean {
  return (
    a.length === b.length &&
    a.every((heading, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        other.lineNumber === heading.lineNumber &&
        other.level === heading.level &&
        other.text === heading.text
      );
    })
  );
}

export type SectionMove = "next" | "previous" | "parent";

/**
 * The line a section command goes to from the stack, or null when it is not
 * offered: where the stack is not at work (outside Live Preview, switched
 * off, a note it has not read yet), or where there is nowhere to go.
 */
export function sectionCommandTarget(input: {
  active: boolean;
  headingIndex: HeadingIndex;
  ancestorStack: readonly HeadingEntry[];
  move: SectionMove;
}): number | null {
  if (!input.active) return null;
  const { headingIndex, ancestorStack, move } = input;
  const current = ancestorStack[ancestorStack.length - 1] ?? null;
  const target =
    move === "next"
      ? nextSection(headingIndex, current)
      : move === "previous"
        ? previousSection(headingIndex, current)
        : (ancestorStack[ancestorStack.length - 2] ?? null);
  return target?.lineNumber ?? null;
}
