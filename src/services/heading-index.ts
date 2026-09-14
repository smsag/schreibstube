import type { HeadingEntry, HeadingIndex } from "../types";
import { fenceMarker } from "./markdown-fence";

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
  let fence: string | null = null;

  for (const [lineNumber, line] of lines.entries()) {
    // A `#` inside a code block is a comment, a shell prompt or a CSS colour,
    // and the stack above the note claimed it as the section being read.
    const marker = fenceMarker(line);
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }

    const match = line.match(HEADING_PATTERN);

    if (!match) {
      continue;
    }

    const hashes = match[1] ?? "";
    const text = stripMarkdownFormatting(match[2] ?? "");

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
