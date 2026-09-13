type FocusMode = "off" | "sentence" | "paragraph";

export interface LineDoc {
  lines: number;
  line: (lineNumber: number) => { text: string };
}

export interface FocusRange {
  startLine: number;
  endLine: number;
  startCh?: number;
  endCh?: number;
}

type BlockKind = "heading" | "list" | "quote" | "paragraph";

const FENCE_REGEX = /^\s*([`~]{3,})/;
const HEADING_REGEX = /^\s{0,3}#{1,6}\s+/;
const LIST_REGEX = /^\s*(?:[-*+]|\d+[.)])\s+/;
const QUOTE_REGEX = /^\s*>/;

export function resolveFocusRange(
  doc: LineDoc,
  zeroBasedCursorLine: number,
  mode: FocusMode,
  cursorColumn?: number
): FocusRange | null {
  if (mode === "off") {
    return null;
  }

  const cursorLine = clampLineNumber(zeroBasedCursorLine + 1, doc.lines);

  if (mode === "sentence") {
    if (cursorColumn !== undefined) {
      const sentence = resolveSentenceSpan(doc.line(cursorLine).text, cursorColumn);
      if (sentence) {
        return {
          startLine: cursorLine,
          endLine: cursorLine,
          startCh: sentence.startCh,
          endCh: sentence.endCh
        };
      }
    }

    return { startLine: cursorLine, endLine: cursorLine };
  }

  return resolveParagraphRange(doc, cursorLine);
}

function resolveParagraphRange(doc: LineDoc, cursorLine: number): FocusRange {
  const fenceRange = resolveFenceRange(doc, cursorLine);
  if (fenceRange) {
    return fenceRange;
  }

  const cursorText = doc.line(cursorLine).text;
  if (isBlank(cursorText)) {
    return { startLine: cursorLine, endLine: cursorLine };
  }

  const targetKind = classifyLine(cursorText);

  if (targetKind === "list") {
    return { startLine: cursorLine, endLine: cursorLine };
  }

  let startLine = cursorLine;
  while (startLine > 1) {
    const prev = doc.line(startLine - 1).text;
    if (isBlank(prev) || classifyLine(prev) !== targetKind || isFenceDelimiter(prev)) {
      break;
    }

    startLine -= 1;
  }

  let endLine = cursorLine;
  while (endLine < doc.lines) {
    const next = doc.line(endLine + 1).text;
    if (isBlank(next) || classifyLine(next) !== targetKind || isFenceDelimiter(next)) {
      break;
    }

    endLine += 1;
  }

  return { startLine, endLine };
}

function resolveFenceRange(doc: LineDoc, cursorLine: number): FocusRange | null {
  let open: { marker: string; length: number; startLine: number } | null = null;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const text = doc.line(lineNumber).text;
    const marker = getFenceMarker(text);

    if (!open) {
      if (marker) {
        open = {
          marker: marker.charAt(0),
          length: marker.length,
          startLine: lineNumber
        };
      }

      continue;
    }

    if (marker && marker.charAt(0) === open.marker && marker.length >= open.length) {
      if (cursorLine >= open.startLine && cursorLine <= lineNumber) {
        return { startLine: open.startLine, endLine: lineNumber };
      }

      open = null;
    }
  }

  if (open && cursorLine >= open.startLine) {
    return { startLine: open.startLine, endLine: doc.lines };
  }

  return null;
}

/**
 * German abbreviations whose full stop is not the end of anything.
 *
 * A heuristic, and deliberately short: the cost of missing one is a sentence
 * that reads as two, the cost of a long list is a stop that never ends a
 * sentence. Single letters and bare numbers are handled by rule rather than
 * listed, which covers "z. B.", "u. a." and every ordinal date.
 */
const ABBREVIATIONS = new Set([
  "abb",
  "bzw",
  "ca",
  "dr",
  "evtl",
  "ggf",
  "hrsg",
  "inkl",
  "nr",
  "prof",
  "str",
  "tel",
  "vgl",
  "usw",
  "zzgl"
]);

/** The word immediately before a full stop, lowercased. */
function tokenBefore(text: string, dot: number): string {
  let start = dot;
  while (start > 0 && /[\p{L}\p{N}]/u.test(text.charAt(start - 1))) start -= 1;
  return text.slice(start, dot).toLowerCase();
}

/**
 * Whether a full stop ends a sentence, or merely a word that is written short.
 *
 * Splitting on every stop turned "Das gilt z. B. für Objekte" into three
 * sentences and focused the last fragment of it, which is the opposite of what
 * focus mode is for.
 */
function endsSentence(text: string, dot: number): boolean {
  const rest = text.slice(dot + 1);
  const next = rest.trimStart().charAt(0);

  // A lowercase letter after a stop means the sentence is still going.
  if (next && next.toLowerCase() === next && next.toUpperCase() !== next) return false;

  const token = tokenBefore(text, dot);
  // "z.", "B.", "1.", "2026." — a single letter or a bare number is a short
  // form or an ordinal, never the end of a thought.
  if (token.length === 1) return false;
  if (/^\p{N}+$/u.test(token)) return false;

  return !ABBREVIATIONS.has(token);
}

function resolveSentenceSpan(
  text: string,
  cursorColumn: number
): { startCh: number; endCh: number } | null {
  const spans: Array<{ startCh: number; endCh: number }> = [];
  let startCh = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== "." && char !== "!" && char !== "?") continue;
    if (char === "." && !endsSentence(text, i)) continue;

    spans.push({ startCh, endCh: i + 1 });
    startCh = i + 1;

    while (startCh < text.length && /\s/.test(text.charAt(startCh))) {
      startCh += 1;
    }
  }

  if (startCh < text.length) {
    spans.push({ startCh, endCh: text.length });
  }

  // The first span the cursor has not passed the end of. Written this way so
  // every column belongs to exactly one sentence: the caret sitting after the
  // final full stop — which is where it sits while the line is being written —
  // used to match nothing at all, and the whole line lit up instead.
  for (const span of spans) {
    if (cursorColumn <= span.endCh) return span;
  }

  return spans[spans.length - 1] ?? null;
}

function clampLineNumber(lineNumber: number, maxLines: number): number {
  return Math.max(1, Math.min(maxLines, lineNumber));
}

function classifyLine(line: string): BlockKind {
  if (HEADING_REGEX.test(line)) {
    return "heading";
  }

  if (LIST_REGEX.test(line)) {
    return "list";
  }

  if (QUOTE_REGEX.test(line)) {
    return "quote";
  }

  return "paragraph";
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function isFenceDelimiter(line: string): boolean {
  return getFenceMarker(line) !== null;
}

function getFenceMarker(line: string): string | null {
  return line.match(FENCE_REGEX)?.[1] ?? null;
}
