import type { HeadingEntry, HeadingIndex } from "../types";

export function resolveAncestorStack(
  headingIndex: HeadingIndex,
  viewportTopLine: number
): HeadingEntry[] {
  const stackByLevel = new Map<number, HeadingEntry>();

  for (const heading of headingIndex) {
    if (heading.lineNumber > viewportTopLine) {
      break;
    }

    stackByLevel.set(heading.level, heading);

    for (let level = heading.level + 1; level <= 6; level += 1) {
      stackByLevel.delete(level);
    }
  }

  const stack = Array.from(stackByLevel.values()).sort((a, b) => a.level - b.level);

  return stack;
}

/**
 * The stack to show when the overlay itself covers the top of the text.
 *
 * `edgeLines[d]` is the line just under the overlay as it stands with `d`
 * rows; `edgeLines[0]` is the line at the very top, where an empty overlay
 * draws nothing. The overlay is as tall as the stack it shows, so measuring
 * under the overlay as it is now made the answer depend on the last one: a
 * stack three rows deep measured three rows down and skipped past a heading,
 * one row deep measured one row down and fell back into the section above,
 * and the stack flipped between the two as the note scrolled.
 *
 * The answer is the first depth whose measurement needs no more rows than it
 * was taken under. Every heading hidden under the overlay that answer draws
 * lies above the line it was measured at, so none of them is left out, and
 * no heading becomes current earlier than it has to.
 */
export function resolveStackUnderOverlay(
  headingIndex: HeadingIndex,
  edgeLines: readonly number[]
): HeadingEntry[] {
  let stack: HeadingEntry[] = [];
  for (const [depth, line] of edgeLines.entries()) {
    stack = resolveAncestorStack(headingIndex, line);
    if (stack.length <= depth) return stack;
  }
  return stack;
}
