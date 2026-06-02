import type { HeadingEntry, HeadingIndex } from "../types";

export function resolveAncestorStack(
  headingIndex: HeadingIndex,
  viewportTopLine: number
): HeadingEntry[] {
  const stackByLevel = new Map<number, HeadingEntry>();

  for (const heading of headingIndex) {
    if (heading.lineNumber >= viewportTopLine) {
      break;
    }

    // Keep the latest heading seen for each level above the viewport.
    stackByLevel.set(heading.level, heading);

    // Remove deeper levels after encountering a shallower/current level.
    for (let level = heading.level + 1; level <= 6; level += 1) {
      stackByLevel.delete(level);
    }
  }

  const stack = Array.from(stackByLevel.values()).sort(
    (a, b) => a.level - b.level
  );

  return stack;
}

function getParentLineNumber(
  headingIndex: HeadingIndex,
  targetIndex: number
): number {
  const target = headingIndex[targetIndex];

  for (let i = targetIndex - 1; i >= 0; i -= 1) {
    const candidate = headingIndex[i];
    if (candidate.level < target.level) {
      return candidate.lineNumber;
    }
  }

  return -1;
}

export function resolveSiblingHeadings(
  headingIndex: HeadingIndex,
  ancestorStack: HeadingEntry[],
  level: number
): HeadingEntry[] {
  const activeAtLevel = ancestorStack.find((entry) => entry.level === level);
  if (!activeAtLevel) {
    return [];
  }

  const activeIndex = headingIndex.findIndex(
    (entry) => entry.lineNumber === activeAtLevel.lineNumber
  );
  if (activeIndex < 0) {
    return [];
  }

  const activeParentLine = getParentLineNumber(headingIndex, activeIndex);

  const siblings: HeadingEntry[] = [];
  for (let i = 0; i < headingIndex.length; i += 1) {
    const entry = headingIndex[i];
    if (entry.level !== level) {
      continue;
    }

    const parentLine = getParentLineNumber(headingIndex, i);
    if (parentLine === activeParentLine) {
      siblings.push(entry);
    }
  }

  return siblings;
}
