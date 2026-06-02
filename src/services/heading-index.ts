import type { HeadingEntry, HeadingIndex } from "../types";

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

export function buildHeadingIndex(content: string): HeadingIndex {
  const lines = content.split(/\r?\n/);
  const result: HeadingEntry[] = [];

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const match = line.match(HEADING_PATTERN);

    if (!match) {
      continue;
    }

    const hashes = match[1];
    const text = match[2].trim();

    if (!text) {
      continue;
    }

    result.push({
      level: hashes.length as HeadingEntry["level"],
      text,
      lineNumber
    });
  }

  return result;
}
