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

/**
 * The cells of a table row, split at the pipes that are not escaped and not
 * inside inline code.
 */
export function splitRow(line: string): MarkdownCell[] {
  const bounds: number[] = [];
  let code = 0;
  for (let at = 0; at < line.length; at++) {
    const char = line[at];
    if (char === "\\") {
      at++;
      continue;
    }
    if (char === "`") {
      let run = 1;
      while (line[at + run] === "`") run++;
      code = code === 0 ? run : code === run ? 0 : code;
      at += run - 1;
      continue;
    }
    if (char === "|" && code === 0) bounds.push(at);
  }

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
