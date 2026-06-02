import type { HeadingIndex } from "../types";

export function resolveViewportLineFromRenderedHeadings(
  headingIndex: HeadingIndex,
  renderedHeadingOffsets: number[],
  scrollTop: number,
  fallbackLine: number
): number {
  if (headingIndex.length === 0 || renderedHeadingOffsets.length === 0) {
    return fallbackLine;
  }

  const maxShared = Math.min(headingIndex.length, renderedHeadingOffsets.length);
  let resolved = fallbackLine;

  for (let i = 0; i < maxShared; i += 1) {
    if (renderedHeadingOffsets[i] <= scrollTop + 1) {
      resolved = headingIndex[i].lineNumber;
    } else {
      break;
    }
  }

  return resolved;
}

export function getRenderedHeadingIndexForSourceLine(
  headingIndex: HeadingIndex,
  lineNumber: number
): number {
  return headingIndex.findIndex((entry) => entry.lineNumber === lineNumber);
}
