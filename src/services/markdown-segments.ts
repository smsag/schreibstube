/**
 * Splits Markdown into the prose blocks a proof-read run may touch, and masks
 * the spans inside them that must survive a rewrite untouched.
 *
 * Two mechanisms, deliberately different:
 *
 * - *Excluded* regions (frontmatter, fenced code, tables, math blocks) drop the
 *   whole block. There is no safe way to let a language model reflow a table.
 * - *Masked* spans (inline code, wikilinks, link targets, tags, bare URLs) are
 *   replaced by opaque placeholder tokens inside an otherwise normal sentence,
 *   so the prose around them is still checked while the span itself cannot be
 *   altered. `restorePlaceholders` puts them back, and a response that lost a
 *   token is rejected by the caller rather than applied.
 */

/** A run of source text that may be sent for review. */
export interface ProseBlock {
  /** Stable within one segmentation pass; used as the wire marker. */
  id: string;
  /** Absolute offset of the block in the source document. */
  from: number;
  to: number;
  /** Verbatim source slice. */
  text: string;
  /** `text` with every protected span replaced by a placeholder token. */
  masked: string;
  /** Protected spans in block-relative offsets into `text`. Local checks that
   *  work on the raw text (glossary matching) use this to stay out of code
   *  spans, links, and tags without going through the masked form. */
  protectedRanges: TextRange[];
}

export interface TextRange {
  from: number;
  to: number;
}

export interface SegmentResult {
  blocks: ProseBlock[];
  /** Placeholder token to the source text it stands for. */
  placeholders: Map<string, string>;
}

/** Placeholder tokens use section signs, which never occur in normal prose and
 *  survive tokenizers intact. */
const PLACEHOLDER_PREFIX = "§P";
const PLACEHOLDER_SUFFIX = "§";

export function placeholderToken(index: number): string {
  return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
}

const PLACEHOLDER_PATTERN = /§P\d+§/g;

const FENCE = /^\s{0,3}(```|~~~)/;
const TABLE_ROW = /^\s{0,3}\|/;
const MATH_BLOCK = /^\s{0,3}\$\$/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;
const BLOCKQUOTE = /^\s*>/;
const HAS_LETTER = /\p{L}/u;

/** Spans masked in place. Order matters: the earliest, longest match wins when
 *  two patterns overlap, so code spans beat the URL pattern inside them. */
const MASK_PATTERNS: RegExp[] = [
  /<!--[\s\S]*?-->/g,
  /`[^`\n]+`/g,
  /!?\[\[[^\]\n]*\]\]/g,
  /\$[^$\n]+\$/g,
  /\bhttps?:\/\/\S+/gu,
  /<\/?[a-zA-Z][^>\n]*>/g
];

/** Patterns whose *capture group* is masked while the surrounding text stays.
 *  Keeps link labels and the words around a tag in the proof-read stream. */
const MASK_GROUP_PATTERNS: RegExp[] = [/\]\(([^)\n]*)\)/g, /(?:^|\s)(#[\p{L}\p{N}_/-]+)/gu];

/** Segment `text` into reviewable prose blocks with protected spans masked. */
export function segmentMarkdown(text: string): SegmentResult {
  const placeholders = new Map<string, string>();
  const blocks: ProseBlock[] = [];
  const lines = splitLines(text);

  let index = 0;
  let blockIndex = 0;

  // A frontmatter block is only frontmatter on the very first line.
  if (lines.length > 0 && lines[0].text.trim() === "---") {
    const close = findLine(lines, 1, (line) => line.text.trim() === "---");
    index = close === -1 ? lines.length : close + 1;
  }

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.text.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    if (FENCE.test(line.text)) {
      const marker = line.text.trim().slice(0, 3);
      const close = findLine(lines, index + 1, (l) => l.text.trim().startsWith(marker));
      index = close === -1 ? lines.length : close + 1;
      continue;
    }

    if (MATH_BLOCK.test(line.text)) {
      // `$$x$$` on one line is a whole block. Looking for the closer on a later
      // line would swallow every paragraph up to the next `$$`, or to the end of
      // the note when there is none — the rest of the note silently unreviewed.
      const close = closesItself(trimmed)
        ? index
        : findLine(lines, index + 1, (l) => l.text.trim().endsWith("$$"));
      index = close === -1 ? lines.length : close + 1;
      continue;
    }

    if (TABLE_ROW.test(line.text)) {
      while (index < lines.length && TABLE_ROW.test(lines[index].text)) {
        index += 1;
      }
      continue;
    }

    // Structural lines are isolated so a rewrite cannot drop the marker that
    // makes them a heading, a list item, or a quote.
    if (HEADING.test(line.text) || LIST_ITEM.test(line.text) || BLOCKQUOTE.test(line.text)) {
      pushBlock(line.from, line.to);
      index += 1;
      continue;
    }

    const start = index;
    while (index < lines.length && isParagraphLine(lines[index].text)) {
      index += 1;
    }
    pushBlock(lines[start].from, lines[index - 1].to);
  }

  return { blocks, placeholders };

  function pushBlock(from: number, to: number): void {
    const raw = text.slice(from, to);
    if (!HAS_LETTER.test(raw)) {
      return;
    }
    const protectedRanges = collectMaskRanges(raw);
    const masked = maskRanges(raw, protectedRanges, placeholders);
    blocks.push({ id: `b${blockIndex++}`, from, to, text: raw, masked, protectedRanges });
  }
}

/** Put every masked span back. Unknown tokens are left as-is so the caller can
 *  detect a response that invented one. */
export function restorePlaceholders(text: string, placeholders: Map<string, string>): string {
  return text.replace(PLACEHOLDER_PATTERN, (token) => placeholders.get(token) ?? token);
}

/** Every placeholder token present in `text`. */
export function listPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_PATTERN) ?? [];
}

/** True when `candidate` carries exactly the placeholders `original` did, each
 *  the same number of times. A false result means the rewrite is unsafe to
 *  apply because a protected span was dropped, duplicated, or invented. */
export function placeholdersIntact(original: string, candidate: string): boolean {
  const expected = countTokens(listPlaceholders(original));
  const actual = countTokens(listPlaceholders(candidate));
  if (expected.size !== actual.size) {
    return false;
  }
  for (const [token, count] of expected) {
    if (actual.get(token) !== count) {
      return false;
    }
  }
  return true;
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/** True when a `$$` line carries its own closing `$$`, so the block opens and
 *  shuts on that line. Four characters is the shortest that can: `$$$$`. */
function closesItself(trimmedLine: string): boolean {
  return trimmedLine.length >= 4 && trimmedLine.endsWith("$$");
}

function isParagraphLine(text: string): boolean {
  if (text.trim().length === 0) return false;
  return (
    !FENCE.test(text) &&
    !TABLE_ROW.test(text) &&
    !MATH_BLOCK.test(text) &&
    !HEADING.test(text) &&
    !LIST_ITEM.test(text) &&
    !BLOCKQUOTE.test(text)
  );
}

interface SourceLine {
  text: string;
  from: number;
  to: number;
}

function splitLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  while (from <= text.length) {
    const newline = text.indexOf("\n", from);
    const to = newline === -1 ? text.length : newline;
    lines.push({ text: text.slice(from, to), from, to });
    if (newline === -1) break;
    from = newline + 1;
  }
  return lines;
}

function findLine(
  lines: SourceLine[],
  start: number,
  predicate: (line: SourceLine) => boolean
): number {
  for (let i = start; i < lines.length; i += 1) {
    if (predicate(lines[i])) return i;
  }
  return -1;
}

function collectMaskRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];

  for (const pattern of MASK_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      ranges.push({ from: match.index, to: match.index + match[0].length });
    }
  }

  for (const pattern of MASK_GROUP_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined || match[1] === undefined) continue;
      const offset = match[0].indexOf(match[1]);
      if (offset === -1) continue;
      const from = match.index + offset;
      ranges.push({ from, to: from + match[1].length });
    }
  }

  return mergeRanges(ranges);
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length === 0) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from || b.to - a.to);
  const merged: TextRange[] = [sorted[0]];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (range.from < last.to) {
      last.to = Math.max(last.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function maskRanges(text: string, ranges: TextRange[], placeholders: Map<string, string>): string {
  if (ranges.length === 0) return text;

  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    const token = placeholderToken(placeholders.size);
    placeholders.set(token, text.slice(range.from, range.to));
    result += text.slice(cursor, range.from) + token;
    cursor = range.to;
  }
  return result + text.slice(cursor);
}

/** True when `[from, to)` overlaps any of `ranges`. Used to keep local checks
 *  out of spans a rewrite must not touch. */
export function overlapsAny(ranges: TextRange[], from: number, to: number): boolean {
  return ranges.some((range) => from < range.to && to > range.from);
}
