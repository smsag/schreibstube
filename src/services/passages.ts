/**
 * The callouts and highlights of a note, for the "Callouts & highlights"
 * layout of Bases.
 *
 * A base lists notes, and what it can show of one is its properties; a
 * callout or a `==highlight==` is in the note's text, which no property and
 * no formula reaches. So the layout reads the text of the notes the base
 * lets through and finds them here: every callout as a card of its own,
 * drawn as the note draws it, and a note's highlights together on one card,
 * each in its line.
 *
 * What counts is what Obsidian shows as one. Not in a fenced or indented
 * code block, not in the properties, not in a comment, and a highlight not
 * in inline code. A callout inside a callout is part of the outer one, and
 * one inside a list item is the item's, not a card.
 *
 * Pure: the layout hands over the text and the options, and draws what this
 * answers.
 */
import { fencedLines } from "./markdown-fence";

/** A callout as written, from its `> [!type]` line to its last quoted line. */
export interface CalloutPassage {
  /** Lower case, as Obsidian matches it: `> [!Warning]` is a warning. */
  type: string;
  /** Zero-based line of the `> [!type]` line, where a press opens the note. */
  line: number;
  /** Its last quoted line, so a highlight inside it is known to be its. */
  endLine: number;
  markdown: string;
}

/**
 * A line holding one or more highlights. `markdown` is the line's text out of
 * the block that holds it — without the quote marks, the list marker or the
 * heading signs, a table row as its cells — since a line drawn on its own
 * would otherwise come out as a stray quote or a row of pipes.
 */
export interface HighlightLine {
  line: number;
  markdown: string;
}

export interface NotePassages {
  callouts: CalloutPassage[];
  highlights: HighlightLine[];
}

/** A note's text larger than this is not read: a note, not a book in one file. */
export const MAX_PASSAGE_NOTE_BYTES = 1024 * 1024;

/** The most notes one view reads; past it the base wants a narrower filter. */
export const MAX_PASSAGE_NOTES = 500;

/** The most cards one view draws. */
export const MAX_PASSAGE_CARDS = 1000;

const CALLOUT_START = /^ {0,3}>[ \t]*\[!([A-Za-z0-9][\w-]*)\][+-]?/;
const QUOTED = /^ {0,3}>/;
const QUOTE_MARKS = /^(?: {0,3}>[ \t]?)+/;
const INDENTED = /^(?: {4}|\t)/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const HIGHLIGHT = /==(?=[^\s=])[^=\n]*?[^\s=]==|==[^\s=]==/;

/** Every callout and every highlighted line of a note, in the order they stand. */
export function findPassages(source: string): NotePassages {
  const original = source.split(/\r?\n/);
  const lines = maskComments(original);
  const code = codeLines(lines);
  const callouts: CalloutPassage[] = [];
  const highlights: HighlightLine[] = [];

  // The last line of the callout being read: a `> [!type]` further down the
  // same quote is a line of that callout, not a callout of its own.
  let inCalloutUntil = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (code[index]) continue;
    const line = lines[index] ?? "";
    const start = index > inCalloutUntil ? CALLOUT_START.exec(line) : null;
    if (start?.[1] !== undefined) {
      let end = index;
      while (end + 1 < lines.length && QUOTED.test(lines[end + 1] ?? "")) end += 1;
      inCalloutUntil = end;
      callouts.push({
        type: start[1].toLowerCase(),
        line: index,
        endLine: end,
        markdown: original.slice(index, end + 1).join("\n")
      });
    }
    if (HIGHLIGHT.test(withoutInlineCode(line))) {
      highlights.push({ line: index, markdown: lineOutOfBlock(original[index] ?? line) });
    }
  }
  return { callouts, highlights };
}

/**
 * Which lines are not prose: the properties, fenced code — a fence inside a
 * quote or callout too — and indented code, which Markdown starts with a
 * line four spaces deep after a blank one and continues over indented and
 * blank lines. Inside a list such a line is the item's next paragraph, not
 * code, as Obsidian shows it.
 */
function codeLines(lines: readonly string[]): boolean[] {
  const code = fencedLines(lines).map((fenced) => fenced === true);
  for (let index = 0; index < frontmatterLines(lines); index += 1) code[index] = true;

  // A fence inside a quote, read on the quote's text without its marks.
  for (let index = 0; index < lines.length;) {
    if (!QUOTED.test(lines[index] ?? "")) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < lines.length && QUOTED.test(lines[end + 1] ?? "")) end += 1;
    const inside = lines.slice(index, end + 1).map((line) => line.replace(QUOTE_MARKS, ""));
    fencedLines(inside).forEach((fenced, offset) => {
      if (fenced) code[index + offset] = true;
    });
    index = end + 1;
  }

  let previousBlank = true;
  let inIndentedCode = false;
  let inList = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const blank = line.trim() === "";
    if (code[index]) {
      inIndentedCode = false;
    } else if (blank) {
      // A blank line neither starts nor ends anything here.
    } else if (INDENTED.test(line)) {
      if (inIndentedCode || (previousBlank && !inList)) {
        inIndentedCode = true;
        code[index] = true;
      }
    } else {
      inIndentedCode = false;
      inList = LIST_ITEM.test(line);
    }
    previousBlank = blank;
  }
  return code;
}

/** A highlighted line's own text, out of the quote, list item, heading or table row it is in. */
function lineOutOfBlock(line: string): string {
  const text = line
    .replace(QUOTE_MARKS, "")
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?/, "")
    .replace(/^#{1,6}[ \t]+/, "")
    .trim();
  if (/^\|.*\|$/.test(text)) {
    return text
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell !== "")
      .join(" · ");
  }
  return text;
}

/**
 * The callout types Obsidian draws alike, by the type each stands for: a
 * filter for `warning` means every callout drawn as a warning.
 */
const CALLOUT_ALIASES: Readonly<Record<string, string>> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote"
};

/** The type a callout is drawn as. */
export function calloutKind(type: string): string {
  const lower = type.toLowerCase();
  return CALLOUT_ALIASES[lower] ?? lower;
}

/** What a view shows: callouts, highlights or both. */
export type PassageShow = "both" | "callouts" | "highlights";

export const PASSAGE_SHOW: readonly PassageShow[] = ["both", "callouts", "highlights"];

export interface PassageOptions {
  /** The callout types to show, lower case; empty shows every type. */
  types: ReadonlySet<string>;
  show: PassageShow;
}

/** The option keys under the view in the `.base` file. */
export const PASSAGE_OPTION = {
  types: "calloutTypes",
  show: "show",
  readingView: "readingView"
} as const;

/**
 * The view's options as the `.base` file holds them, which a person may
 * have edited by hand: types as a list or one comma-separated text, the
 * leading `[!` and `]` forgiven, and anything unknown read as the default.
 */
export function readPassageOptions(types: unknown, show: unknown): PassageOptions {
  const written = Array.isArray(types) ? types : typeof types === "string" ? types.split(",") : [];
  const names = written
    .filter((value): value is string => typeof value === "string")
    .map((value) =>
      value
        .trim()
        .replace(/^\[?!?/, "")
        .replace(/\]$/, "")
        .trim()
        .toLowerCase()
    )
    .filter((value) => value !== "")
    .map(calloutKind);
  return {
    types: new Set(names),
    show: PASSAGE_SHOW.find((value) => value === show) ?? "both"
  };
}

/** Whether a view opens notes in Reading view: only a `true` that was set says so. */
export function opensPassageForReading(value: unknown): boolean {
  return value === true || value === "true";
}

/** A card the view draws: one callout, or a note's highlighted lines. */
export type PassageCard =
  | { kind: "callout"; path: string; callout: CalloutPassage }
  | { kind: "highlights"; path: string; lines: HighlightLine[] };

export interface PassageCardResult {
  cards: PassageCard[];
  /** Cards left out because the view reached its limit. */
  held: number;
}

/**
 * A group's cards in the base's order of notes, each note's callouts in the
 * order they stand and its highlights after them on one card. `room` is how
 * many cards the view may still draw.
 */
export function passageCards(
  notes: readonly { path: string; passages: NotePassages }[],
  options: PassageOptions,
  room: number = MAX_PASSAGE_CARDS
): PassageCardResult {
  const cards: PassageCard[] = [];
  let held = 0;
  const add = (card: PassageCard): void => {
    if (cards.length < room) cards.push(card);
    else held += 1;
  };
  for (const { path, passages } of notes) {
    const shown =
      options.show === "highlights"
        ? []
        : passages.callouts.filter(
            (callout) => options.types.size === 0 || options.types.has(calloutKind(callout.type))
          );
    for (const callout of shown) add({ kind: "callout", path, callout });
    if (options.show === "callouts") continue;
    // A highlight in a callout on the page is on its card already.
    const lines = passages.highlights.filter(
      (highlight) =>
        !shown.some(
          (callout) => highlight.line >= callout.line && highlight.line <= callout.endLine
        )
    );
    if (lines.length > 0) add({ kind: "highlights", path, lines });
  }
  return { cards, held };
}

/** The lines of the properties at the top, which are no part of the text. */
function frontmatterLines(lines: readonly string[]): number {
  if (lines[0]?.trimEnd() !== "---") return 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)\s*$/.test(lines[index] ?? "")) return index + 1;
  }
  return 0;
}

/** The text with `%%…%%` and `<!-- … -->` blanked out, every line where it was. */
function maskComments(lines: readonly string[]): string[] {
  const fenced = fencedLines(lines);
  let open: "%%" | "-->" | null = null;
  return lines.map((line, index) => {
    if (fenced[index] && open === null) return line;
    const searchable = withoutInlineCode(line);
    let out = "";
    let at = 0;
    while (at < line.length) {
      if (open !== null) {
        const close = line.indexOf(open, at);
        if (close === -1) {
          out += " ".repeat(line.length - at);
          at = line.length;
        } else {
          out += " ".repeat(close + open.length - at);
          at = close + open.length;
          open = null;
        }
        continue;
      }
      // Looked for where inline code is blanked: `%%` written in code is not a comment.
      const percent = searchable.indexOf("%%", at);
      const html = searchable.indexOf("<!--", at);
      const next = [percent, html].filter((value) => value !== -1).sort((a, b) => a - b)[0];
      if (next === undefined) {
        out += line.slice(at);
        break;
      }
      out += line.slice(at, next);
      open = next === percent ? "%%" : "-->";
      out += " ".repeat(open === "%%" ? 2 : 4);
      at = next + (open === "%%" ? 2 : 4);
    }
    return out;
  });
}

/** A line with its inline code blanked out, so `==x==` in code is not a highlight. */
function withoutInlineCode(line: string): string {
  return line.replace(/(`+)[^`]*?\1/g, (code) => " ".repeat(code.length));
}
