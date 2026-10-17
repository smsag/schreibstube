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
 * The overlay is one line of fixed height, drawn only when there is a stack.
 * Above the first heading nothing covers the text, so the line at the very
 * top decides whether there is a stack at all; once there is one, the line
 * just under the overlay decides which, so no heading hides under the
 * overlay unnamed.
 */
export function resolveStackUnderOverlay(
  headingIndex: HeadingIndex,
  topLine: number,
  lineUnderOverlay: number
): HeadingEntry[] {
  if (resolveAncestorStack(headingIndex, topLine).length === 0) return [];
  return resolveAncestorStack(headingIndex, Math.max(topLine, lineUnderOverlay));
}
