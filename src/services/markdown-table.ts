/**
 * The shape of a pipe table, as everything that reads one needs it.
 *
 * Three readers — the converter, the formulas, the glossary — each split a
 * row on their own, and each got a different answer for a `\|` or a pipe
 * inside a code span. One rule, here, and the same cells everywhere.
 */

/**
 * The row under a table's header: `|---|:--:|`, tested on the trimmed line.
 *
 * Trimmed first, on purpose. A pattern that opened with `\s*` and let every
 * cell carry `\s*` on both sides had two ways to divide any run of spaces
 * between neighbours, and a line of thirty thousand spaces took seconds to
 * refuse. Here every run of whitespace is bounded by a `|` or a `-` that has
 * to be there, so there is one way to read it and the refusal is immediate.
 */
export const TABLE_DELIMITER = /^\|?\s*:?-+:?(?:\s*\|\s*:?-+:?)*\s*\|?$/;

export function isTableDelimiter(line: string): boolean {
  return TABLE_DELIMITER.test(line.trim());
}

/** A cell of a Markdown table row, and where its text sits in the line. */
export interface MarkdownCell {
  from: number;
  to: number;
  /** As written, padding and escapes included, so the line can be rewritten around it. */
  text: string;
}

/** A run of backticks in a row, and what it turned out to be. */
interface BacktickRun {
  at: number;
  length: number;
  /** Opens a code span, closes one, sits inside one, or is plain text. */
  role: "open" | "close" | "inside" | "literal";
}

/**
 * Where a row's unescaped pipes are, and how its backtick runs pair up.
 *
 * A backslash makes the character after it ordinary, whatever it is, so an
 * escaped backtick is no run and an escaped pipe no separator. A run of
 * backticks opens a code span only when a run of exactly the same length
 * follows later in the row; the first such run closes it. A run with no
 * partner is plain text, as in CommonMark: the `it`s` in a cell does not
 * swallow the pipes that come after it.
 */
function scanRow(line: string): {
  pipes: number[];
  runs: BacktickRun[];
  /** Each code span as [from, to): the opening run's start to the closing run's end. */
  spans: [number, number][];
} {
  const pipes: number[] = [];
  const runs: BacktickRun[] = [];
  for (let at = 0; at < line.length; at++) {
    const char = line[at];
    if (char === "\\") {
      at++;
      continue;
    }
    if (char === "`") {
      let length = 1;
      while (line[at + length] === "`") length++;
      runs.push({ at, length, role: "literal" });
      at += length - 1;
      continue;
    }
    if (char === "|") pipes.push(at);
  }

  // The next run of each run's length, found once from the right so a row of
  // thousands of backticks costs a pass, not a search per run.
  const next: (number | undefined)[] = [];
  const seen = new Map<number, number>();
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!;
    next[i] = seen.get(run.length);
    seen.set(run.length, i);
  }
  const spans: [number, number][] = [];
  for (let i = 0; i < runs.length; i++) {
    const partner = next[i];
    if (partner === undefined) continue;
    const open = runs[i]!;
    const close = runs[partner]!;
    open.role = "open";
    close.role = "close";
    for (let inside = i + 1; inside < partner; inside++) runs[inside]!.role = "inside";
    spans.push([open.at, close.at + close.length]);
    i = partner;
  }
  return { pipes, runs, spans };
}

/**
 * The cells of a table row, split at the pipes that are not escaped and not
 * inside inline code.
 */
export function splitRow(line: string): MarkdownCell[] {
  const { pipes, spans } = scanRow(line);
  let span = 0;
  const bounds = pipes.filter((pipe) => {
    while (span < spans.length && spans[span]![1] <= pipe) span++;
    const current = spans[span];
    return !(current && current[0] < pipe);
  });

  const cells: MarkdownCell[] = [];
  let start = 0;
  for (const bound of [...bounds, line.length]) {
    cells.push({ from: start, to: bound, text: line.slice(start, bound) });
    start = bound + 1;
  }
  // The pipes at either end frame the row rather than separate cells.
  if (line.trimStart().startsWith("|")) cells.shift();
  if (bounds.length > 0 && line.trimEnd().endsWith("|") && !line.trimEnd().endsWith("\\|")) {
    cells.pop();
  }
  return cells;
}

/** The cells' text alone, trimmed, for a reader that does not write back. */
export function rowCells(line: string): string[] {
  return splitRow(line).map((cell) => cell.text.trim());
}

/**
 * A cell's text as it has to be written so that `splitRow` reads it back as
 * one cell: every pipe escaped, and a backslash already standing before a pipe
 * doubled, or `\\|` would read as an escaped backslash and a real separator.
 * A backtick run with no partner in the cell is escaped too, every backtick of
 * it: left alone, the next cell's backtick of the same length would pair with
 * it and the code span would carry the separator between them away. A line
 * break would end the row, so it becomes the `<br>` a table renders.
 */
export function escapeCell(text: string): string {
  const piped = text.replace(/(\\+)(?=\|)/g, "$1$1").replace(/\|/g, "\\|");
  const unpaired = scanRow(piped).runs.filter((run) => run.role === "literal");
  let escaped = piped;
  for (const run of unpaired.reverse()) {
    escaped = `${escaped.slice(0, run.at)}${"\\`".repeat(run.length)}${escaped.slice(run.at + run.length)}`;
  }
  return escaped.replace(/\r\n|\r|\n/g, "<br>");
}
