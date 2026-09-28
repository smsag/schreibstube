/**
 * Formulas in table cells: `=sum`, `=avg`, `=median`, `=count`, `=min`, `=max`.
 *
 * A formula stands alone in its cell and works on the cells above it in the
 * same column, back to the header. Other formulas above it are not counted,
 * so a subtotal row does not count twice. The note keeps the formula; only
 * what is shown, and what leaves the vault, carries the result.
 *
 * `=sum(fixed)` asks for a result that stays. The first time the note leaves
 * the vault — mail, publish, print — the result is written into the cell,
 * `=sum(fixed: 342,17 €)`, and from then on the cell shows that and nothing
 * else: the number the recipient got, whatever the amounts or the rates are
 * afterwards. Freezing is a write, and a write belongs to a send; a note that
 * is only being looked at is never changed, or two devices would each write
 * their own number.
 *
 * The grid is plain strings, so the same rules serve the Markdown of a note
 * and the cells of a rendered table.
 */
import { readCell, TABLE_DELIMITER, type Amount } from "./amounts";
import {
  compute,
  outcomeText,
  type FormulaContext,
  type FormulaOp,
  type Outcome
} from "./formulas";
import { fencedLines } from "./markdown-fence";

export interface Formula {
  op: FormulaOp;
  /** Asked to stay: `(fixed)`. */
  fixed: boolean;
  /** What it was frozen at, once it has been: the text after `fixed:`. */
  frozen: string | null;
  /** Emphasis around the formula, kept around the result: `**=sum**`. */
  wrap: string;
}

const FORMULA =
  /^(?<wrap>\*{1,2}|_{1,2})?\s*=(?<op>sum|avg|median|count|min|max)(?:\(\s*(?<fixed>fixed)\s*(?::\s*(?<frozen>.*?))?\s*\))?\s*\k<wrap>$/iu;

/** The formula a cell holds, or null when it holds anything else. */
export function parseFormula(cell: string): Formula | null {
  const match = FORMULA.exec(cell.trim());
  if (!match?.groups) return null;
  const { wrap, op, fixed, frozen } = match.groups;
  return {
    op: (op ?? "sum").toLowerCase() as FormulaOp,
    fixed: fixed !== undefined,
    frozen: frozen ? frozen.trim() : null,
    wrap: wrap ?? ""
  };
}

/** One formula's result in a grid. */
export interface CellResult {
  row: number;
  col: number;
  formula: Formula;
  outcome: Outcome;
  /** Cells above with text but no amount, left out of the result. */
  skipped: number;
  /**
   * What the cell says: the frozen text of a frozen formula, the result of
   * any other, or null for a result that is not a number (mixed currencies,
   * an average of nothing) — the caller puts that into words.
   */
  text: string | null;
  /** For a frozen formula: what it would come to now, when that differs. */
  now: string | null;
  /** For a `(fixed)` formula not frozen yet: the text it freezes at. */
  freezeAt: string | null;
}

/**
 * Every formula in a table and what it comes to.
 *
 * `rows[0]` is the header row, which no formula counts.
 */
export function evaluateGrid(
  rows: readonly (readonly string[])[],
  ctx: FormulaContext
): CellResult[] {
  const results: CellResult[] = [];
  for (let row = 1; row < rows.length; row++) {
    const cells = rows[row] ?? [];
    for (let col = 0; col < cells.length; col++) {
      const formula = parseFormula(cells[col] ?? "");
      if (!formula) continue;

      const amounts: Amount[] = [];
      let skipped = 0;
      for (let above = 1; above < row; above++) {
        const cell = rows[above]?.[col] ?? "";
        if (parseFormula(cell)) continue;
        const reading = readCell(cell, ctx.format);
        if (reading.kind === "amount") amounts.push(reading.amount);
        else if (reading.kind === "unreadable") skipped++;
      }

      const outcome = compute(formula.op, amounts, ctx);
      const current = outcomeText(outcome, ctx.format);
      if (formula.frozen !== null) {
        results.push({
          row,
          col,
          formula,
          outcome,
          skipped,
          text: formula.frozen,
          now: changedSince(formula.frozen, outcome, current),
          freezeAt: null
        });
      } else {
        results.push({
          row,
          col,
          formula,
          outcome,
          skipped,
          text: current,
          now: null,
          freezeAt: formula.fixed ? current : null
        });
      }
    }
  }
  return results;
}

const RATE_DAY = /\s*·\s*ECB\s+\S+\s*$/;

/** A result as a person reads it: a space is a space, whichever the file holds. */
function asRead(text: string): string {
  return text
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .replace(RATE_DAY, "")
    .trim();
}

/**
 * What a frozen result would be now, or null when it has not changed.
 *
 * Compared as read, not as stored: a value typed with a plain space is the
 * value the plugin writes with one that cannot break. The rates' day is not
 * part of the value — rates fetched again without the amounts changing leave
 * the result where it was. And a result converted then is only compared with
 * one converted now: switching converting off, or on, is no change in what
 * the table holds.
 */
function changedSince(frozen: string, outcome: Outcome, current: string | null): string | null {
  if (current === null) return null;
  const convertedThen = RATE_DAY.test(frozen);
  const convertedNow = outcome.kind === "value" && outcome.rateDate !== null;
  if (convertedThen !== convertedNow) return null;
  return asRead(current) === asRead(frozen) ? null : current;
}

/** A cell of a Markdown table row, and where its text sits in the line. */
interface MarkdownCell {
  from: number;
  to: number;
  text: string;
}

interface MarkdownRow {
  line: number;
  cells: MarkdownCell[];
}

/** A table in a note: its header row first, then its body rows; no delimiter row. */
export interface MarkdownTable {
  rows: MarkdownRow[];
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

/** Every table in a note, outside code blocks. */
export function findTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split("\n");
  const fenced = fencedLines(lines);
  const tables: MarkdownTable[] = [];

  for (let at = 0; at + 1 < lines.length; at++) {
    const header = lines[at] ?? "";
    const delimiter = lines[at + 1] ?? "";
    if (fenced[at] || fenced[at + 1] || !header.includes("|") || !delimiter.includes("|")) continue;
    if (!TABLE_DELIMITER.test(delimiter)) continue;
    const headerCells = splitRow(header);
    if (headerCells.length !== splitRow(delimiter).length) continue;

    const rows: MarkdownRow[] = [{ line: at, cells: headerCells }];
    let body = at + 2;
    while (body < lines.length && !fenced[body]) {
      const line = lines[body] ?? "";
      if (line.trim() === "" || !line.includes("|")) break;
      rows.push({ line: body, cells: splitRow(line) });
      body++;
    }
    tables.push({ rows });
    at = body - 1;
  }
  return tables;
}

/**
 * Rewrite every formula cell in a note, keeping the rest of the line as it is.
 *
 * `write` gets each result and says what the cell should hold, or null to
 * leave it. The cell's own padding is kept, so a table laid out by hand stays
 * laid out.
 */
function rewriteCells(
  markdown: string,
  ctx: FormulaContext,
  write: (result: CellResult) => string | null
): { text: string; changed: number } {
  const lines = markdown.split("\n");
  let changed = 0;
  for (const table of findTables(markdown)) {
    const grid = table.rows.map((row) => row.cells.map((cell) => cell.text));
    // Right to left within a line, so an earlier cell's offsets still hold.
    const results = evaluateGrid(grid, ctx).sort((a, b) => b.col - a.col);
    for (const result of results) {
      const content = write(result);
      if (content === null) continue;
      const row = table.rows[result.row];
      const cell = row?.cells[result.col];
      if (!row || !cell) continue;
      writeCell(lines, row.line, cell, content);
      changed++;
    }
  }
  return { text: lines.join("\n"), changed };
}

/** Put new content into a cell, keeping the cell's own padding. */
function writeCell(lines: string[], at: number, cell: MarkdownCell, content: string): void {
  const line = lines[at] ?? "";
  const lead = /^\s*/.exec(cell.text)?.[0] ?? "";
  const trail = /\s*$/.exec(cell.text)?.[0] ?? "";
  lines[at] = line.slice(0, cell.from) + lead + content + trail + line.slice(cell.to);
}

/** A pipe in a result would split the cell it is written into. */
function cellSafe(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/**
 * The note as it leaves the vault: every formula replaced by its result.
 *
 * A `(fixed)` formula not yet frozen shows what it is about to be frozen at,
 * which is the same number, so the copy sent and the value written back agree.
 * A result that is not a number is written as `unavailable` says.
 */
export function resolveFormulas(
  markdown: string,
  ctx: FormulaContext,
  unavailable: (outcome: Outcome) => string
): string {
  return rewriteCells(markdown, ctx, (result) => {
    const text = result.text ?? unavailable(result.outcome);
    return `${result.formula.wrap}${cellSafe(text)}${result.formula.wrap}`;
  }).text;
}

/** One `(fixed)` formula waiting to be frozen, in the order it stands in the note. */
export interface FreezeEntry {
  op: FormulaOp;
  /** What it freezes at, or null for a result without a number, which waits. */
  text: string | null;
}

/**
 * What each `(fixed)` formula not yet frozen would be frozen at.
 *
 * Taken from the copy that leaves the vault, at the moment it leaves, so what
 * is written back later is what the recipient got — not what the note says by
 * the time the upload or the typesetting is over.
 */
export function freezePlan(markdown: string, ctx: FormulaContext): FreezeEntry[] {
  return findTables(markdown).flatMap((table) =>
    evaluateGrid(
      table.rows.map((row) => row.cells.map((cell) => cell.text)),
      ctx
    )
      .filter((result) => result.formula.fixed && result.formula.frozen === null)
      .map((result) => ({ op: result.formula.op, text: result.freezeAt }))
  );
}

/**
 * The note with a freeze plan written into it, or null when the note no
 * longer has the formulas the plan was made for.
 *
 * The plan is matched to the note's waiting `(fixed)` formulas by order and
 * operation. A note whose tables changed in between — a formula added,
 * removed or changed — cannot be matched safely, and is not written at all:
 * a value frozen into the wrong cell would be worse than one left live.
 */
export function applyFreezes(
  markdown: string,
  plan: readonly FreezeEntry[]
): { text: string; frozen: number } | null {
  const waiting: { line: number; cell: MarkdownCell; formula: Formula }[] = [];
  for (const table of findTables(markdown)) {
    for (const row of table.rows.slice(1)) {
      for (const cell of row.cells) {
        const formula = parseFormula(cell.text);
        if (formula?.fixed && formula.frozen === null)
          waiting.push({ line: row.line, cell, formula });
      }
    }
  }
  if (waiting.length !== plan.length) return null;
  if (waiting.some((entry, at) => entry.formula.op !== plan[at]?.op)) return null;

  const lines = markdown.split("\n");
  let frozen = 0;
  // Right to left, so a cell's offsets still hold after the one after it changed.
  for (let at = waiting.length - 1; at >= 0; at--) {
    const entry = waiting[at];
    const text = plan[at]?.text ?? null;
    if (!entry || text === null) continue;
    const { op, wrap } = entry.formula;
    writeCell(
      lines,
      entry.line,
      entry.cell,
      `${wrap}=${op}(fixed: ${cellSafe(text).replace(/\)/g, "")})${wrap}`
    );
    frozen++;
  }
  return { text: lines.join("\n"), frozen };
}

/** The note with every `(fixed)` formula not yet frozen frozen at its result now. */
export function freezeFormulas(
  markdown: string,
  ctx: FormulaContext
): { text: string; frozen: number } {
  return applyFreezes(markdown, freezePlan(markdown, ctx)) ?? { text: markdown, frozen: 0 };
}

/** What every formula in a note comes to, to know whether any of it needs rates. */
export function formulaOutcomes(markdown: string, ctx: FormulaContext): Outcome[] {
  return findTables(markdown).flatMap((table) =>
    evaluateGrid(
      table.rows.map((row) => row.cells.map((cell) => cell.text)),
      ctx
    ).map((result) => result.outcome)
  );
}
