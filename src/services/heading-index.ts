import type { HeadingEntry, HeadingIndex } from "../types";

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, page, alias) => alias ?? page)
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")
    .replace(/_{1,2}([^_\n]+)_{1,2}/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/==([^=\n]+)==/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

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
    const text = stripMarkdownFormatting(match[2]);

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
