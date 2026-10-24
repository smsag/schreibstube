import type { HeadingEntry, HeadingIndex } from "../types";
import { splitFrontmatter } from "./frontmatter-block";
import { closesFence, fenceMarker } from "./markdown-fence";

/**
 * A heading as CommonMark reads one, so the note and its published page agree
 * on what the sections are: up to three spaces before the hashes, and a
 * closing run of hashes that is markup, not words.
 */
const HEADING_PATTERN = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
/** The line under a setext heading: `===` makes the paragraph above it level 1, `---` level 2. */
const SETEXT_PATTERN = /^ {0,3}(=+|-+)[ \t]*$/;
/** Lines that start a block of their own, so they neither start nor continue a paragraph. */
const LIST_ITEM_PATTERN = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const BLOCKQUOTE_PATTERN = /^ {0,3}>/;
const RULE_PATTERN = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A table's delimiter row, which makes the lines above it a table and not a paragraph. */
const TABLE_DELIMITER_PATTERN =
  /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$|^[ \t]*\|[ \t]*:?-+:?[ \t]*\|?[ \t]*$/;

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

/** How many lines pass between two looks at the clock while a scan may give up. */
const EXPIRY_STRIDE = 256;

export function buildHeadingIndex(content: string): HeadingIndex {
  return scanHeadings(content, () => false) ?? [];
}

/**
 * The headings, or null once `expired` says the time is up. A view that has
 * to stay responsive asks for this one: the scan is synchronous, so the only
 * way to bound it is to look at the clock as it goes.
 */
export function scanHeadings(content: string, expired: () => boolean): HeadingIndex | null {
  const lines = content.split(/\r?\n/);
  const result: HeadingEntry[] = [];
  // A `# comment` in the properties is YAML, and it stood in the stack as
  // the note's first heading.
  const bodyStart = frontmatterLines(content);
  let fence: string | null = null;
  /** The paragraph being read, which a `===` or `---` line under it turns into a heading. */
  let paragraph: { start: number; lines: string[]; table: boolean } | null = null;
  /**
   * In a list item or a quote: a line under it continues that block, lazily,
   * and never becomes a paragraph a `---` could turn into a heading.
   */
  let inContainer = false;

  for (let lineNumber = bodyStart; lineNumber < lines.length; lineNumber += 1) {
    if (lineNumber % EXPIRY_STRIDE === EXPIRY_STRIDE - 1 && expired()) return null;
    const line = lines[lineNumber] ?? "";

    // A `#` inside a code block is a comment, a shell prompt or a CSS colour,
    // and the stack above the note claimed it as the section being read.
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const marker = fenceMarker(line);
    if (marker && !/^ {4}/.test(line)) {
      fence = marker;
      paragraph = null;
      continue;
    }

    if (line.trim() === "") {
      paragraph = null;
      inContainer = false;
      continue;
    }

    const setext = paragraph && !paragraph.table ? SETEXT_PATTERN.exec(line) : null;
    if (paragraph && setext) {
      const text = stripMarkdownFormatting(paragraph.lines.map((part) => part.trim()).join(" "));
      if (text) {
        result.push({
          level: (setext[1]?.startsWith("=") ? 1 : 2) as HeadingEntry["level"],
          text,
          lineNumber: paragraph.start
        });
      }
      paragraph = null;
      continue;
    }

    const match = HEADING_PATTERN.exec(line);
    if (match) {
      paragraph = null;
      inContainer = false;
      const text = stripMarkdownFormatting(match[2] ?? "");
      if (text) {
        result.push({
          level: (match[1] ?? "").length as HeadingEntry["level"],
          text,
          lineNumber
        });
      }
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      paragraph = null;
      continue;
    }
    if (LIST_ITEM_PATTERN.test(line) || BLOCKQUOTE_PATTERN.test(line)) {
      paragraph = null;
      inContainer = true;
      continue;
    }
    if (inContainer) continue;

    if (paragraph) {
      paragraph.lines.push(line);
      if (line.includes("|") && TABLE_DELIMITER_PATTERN.test(line)) paragraph.table = true;
    } else if (!/^ {4}|^\t/.test(line)) {
      paragraph = { start: lineNumber, lines: [line], table: false };
    }
  }

  return result;
}

/**
 * How many lines the frontmatter takes, fences included, or zero. The block
 * `splitFrontmatter` finds: a closing `...` or a fence with a trailing space
 * read as the start of the body here, and the YAML comments above it as the
 * note's first headings.
 */
function frontmatterLines(content: string): number {
  const { block } = splitFrontmatter(content);
  return block === "" ? 0 : block.replace(/\n$/, "").split("\n").length;
}
