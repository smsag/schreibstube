import type { Plugin } from "obsidian";
import { t } from "../i18n";
import type { FormulaContext, Outcome } from "../services/formulas";
import { evaluateGrid, type CellResult } from "../services/table-formulas";

export interface TableFormulaHost {
  context(): FormulaContext;
  unavailable(outcome: Outcome): string;
  /** Results on screen that fresher rates would change; the next drawing shows them. */
  seen(outcomes: readonly Outcome[]): void;
}

/**
 * Reading view: a formula cell shows its result.
 *
 * The rendered table is read as text, cell by cell, and evaluated with the
 * same rules the Markdown is; only the formula cells are touched. The cell's
 * own title keeps the formula, so what the note says is a hover away. What was
 * left out, and what a frozen result would be now, is said beside the number,
 * on screen only: neither belongs in a copy that leaves the vault.
 */
export function registerTableFormulaPostProcessor(plugin: Plugin, host: TableFormulaHost): void {
  plugin.registerMarkdownPostProcessor((el) => {
    const tables = el.querySelectorAll("table");
    if (tables.length === 0) return;
    const ctx = host.context();
    const outcomes: Outcome[] = [];
    for (const table of Array.from(tables)) {
      const rows = Array.from(table.rows);
      const grid = rows.map((row) => Array.from(row.cells).map((cell) => cell.textContent ?? ""));
      for (const result of evaluateGrid(grid, ctx)) {
        const cell = rows[result.row]?.cells[result.col];
        if (cell) show(cell, result, host);
        outcomes.push(result.outcome);
      }
    }
    if (outcomes.length > 0) host.seen(outcomes);
  });
}

function show(cell: HTMLTableCellElement, result: CellResult, host: TableFormulaHost): void {
  const formula = (cell.textContent ?? "").trim();
  // `**=sum**` renders as a <strong> holding the formula: the result goes
  // inside it, so the total stays as bold as the formula was. Compared by
  // text, not by class: a note in a pop-out window has its own HTMLElement.
  const only = cell.children.length === 1 ? (cell.firstElementChild as HTMLElement | null) : null;
  const target = only && only.textContent?.trim() === formula ? only : cell;
  cell.setAttr("title", formula);
  target.empty();
  target.createSpan({
    cls: "schreibstube-formula",
    text: result.text ?? host.unavailable(result.outcome)
  });

  const notes: string[] = [];
  if (result.skipped > 0) notes.push(t().sums.skipped(result.skipped));
  if (result.now !== null) notes.push(t().sums.now(result.now));
  if (notes.length > 0) {
    target.createSpan({ cls: "schreibstube-formula-note", text: `(${notes.join(", ")})` });
  }
}
