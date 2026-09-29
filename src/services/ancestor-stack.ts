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
