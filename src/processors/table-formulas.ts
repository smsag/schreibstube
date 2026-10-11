import type { Plugin } from "obsidian";
import { t } from "../i18n";
import type { FormulaContext, Outcome } from "../services/formulas";
import { evaluateGrid, type CellResult } from "../services/table-formulas";
import { livePreviewCellContent, livePreviewCellOf } from "../services/workspace-internals";

export interface TableFormulaHost {
  context(): FormulaContext;
  unavailable(outcome: Outcome): string;
  /** Results on screen that fresher rates would change; the next drawing shows them. */
  seen(outcomes: readonly Outcome[]): void;
  /** Whether Live Preview shows a formula's result: the setting for calculating while writing. */
  inEditor(): boolean;
}

export interface TableFormulas {
  /** Draw the tables Live Preview has on screen again: rates came, or the setting changed. */
  redrawEditor(): void;
}

const RESULT_CLASS = "schreibstube-formula";

/** On a cell Live Preview shows a result in: the formula that result stands for. */
const FORMULA_ATTRIBUTE = "data-schreibstube-formula";

/**
 * A formula cell shows its result, in Reading view and in Live Preview.
 *
 * Reading view: the rendered table is read as text, cell by cell, and
 * evaluated with the same rules the Markdown is; only the formula cells are
 * touched. The cell's own title keeps the formula, so what the note says is a
 * hover away. What was left out, and what a frozen result would be now, is
 * said beside the number, on screen only: neither belongs in a copy that
 * leaves the vault.
 *
 * Live Preview: Obsidian draws a table cell by cell and hands over one cell at
 * a time, so the whole table is read from what its cells show once the cell
 * Obsidian is drawing is done. A cell is its own reveal: while the cursor is
 * in it Obsidian shows its text in an editor and leaves what we drew
 * underneath, hidden, and the result is back when the cursor leaves. The
 * notes are left out there; a person typing the amounts has the table in front
 * of them.
 */
export function registerTableFormulaPostProcessor(
  plugin: Plugin,
  host: TableFormulaHost
): TableFormulas {
  // The tables Live Preview has drawn, so rates or the setting can reach them.
  // Dropped as they leave the document: a table is drawn again, as a new
  // element, whenever Obsidian redraws all of it.
  const drawn = new Set<HTMLTableElement>();
  const queued = new WeakSet<HTMLTableElement>();

  const drawSoon = (table: HTMLTableElement): void => {
    drawn.add(table);
    if (queued.has(table)) return;
    queued.add(table);
    // After the cell being drawn, and the ones after it: a table is drawn as a
    // run of cells, and reading it halfway would see the rest as they were.
    queueMicrotask(() => {
      queued.delete(table);
      for (const other of drawn) {
        if (other !== table && !other.isConnected && !queued.has(other)) drawn.delete(other);
      }
      drawEditorTable(table, host);
    });
  };

  plugin.registerMarkdownPostProcessor((el) => {
    const live = livePreviewCellOf(el);
    if (live) {
      // Followed with the setting off too: Obsidian keeps a table on screen
      // while the note changes between Live Preview and Reading view, so a
      // switch turned on later has this one to draw, and one turned off has
      // results to take away.
      drawSoon(live.table);
      return;
    }

    const tables = el.querySelectorAll("table");
    if (tables.length === 0) return;
    const ctx = host.context();
    const outcomes: Outcome[] = [];
    for (const table of Array.from(tables)) {
      const rows = Array.from(table.rows);
      const grid = rows.map((row) => Array.from(row.cells).map((cell) => cell.textContent));
      for (const result of evaluateGrid(grid, ctx)) {
        const cell = rows[result.row]?.cells[result.col];
        if (cell) show(cell, result, host);
        outcomes.push(result.outcome);
      }
    }
    if (outcomes.length > 0) host.seen(outcomes);
  });

  return {
    redrawEditor() {
      for (const table of [...drawn]) {
        if (table.isConnected) drawEditorTable(table, host);
        else drawn.delete(table);
      }
    }
  };
}

/** Puts a result where a formula was, inside the emphasis around it: `**=sum**` stays bold. */
function placeResult(content: HTMLElement, formula: string, text: string): void {
  // Compared by text, not by class: a note in a pop-out window has its own HTMLElement.
  const only =
    content.children.length === 1 ? (content.firstElementChild as HTMLElement | null) : null;
  const target = only && only.textContent.trim() === formula ? only : content;
  target.empty();
  target.createSpan({ cls: RESULT_CLASS, text });
}

function show(cell: HTMLTableCellElement, result: CellResult, host: TableFormulaHost): void {
  const formula = cell.textContent.trim();
  cell.setAttribute("title", formula);
  placeResult(cell, formula, result.text ?? host.unavailable(result.outcome));

  const notes: string[] = [];
  if (result.skipped > 0) notes.push(t().sums.skipped(result.skipped));
  if (result.now !== null) notes.push(t().sums.now(result.now));
  if (notes.length > 0) {
    const target = cell.querySelector(`.${RESULT_CLASS}`)?.parentElement ?? cell;
    target.createSpan({ cls: "schreibstube-formula-note", text: `(${notes.join(", ")})` });
  }
}

/**
 * Every formula cell of one Live Preview table, drawn or put back as written.
 *
 * A cell this has drawn holds the result, so the formula it stands for is
 * kept on the cell; another formula below must still not count it as an
 * amount. Obsidian drawing a cell again (it was edited) leaves no result in
 * it, and then what the cell holds is the truth and the kept formula is not.
 */
function drawEditorTable(table: HTMLTableElement, host: TableFormulaHost): void {
  const cells = Array.from(table.rows).map((row) => Array.from(row.cells));
  const shown = (cell: HTMLTableCellElement): HTMLElement | null =>
    (livePreviewCellContent(cell)?.content ?? cell).querySelector(`.${RESULT_CLASS}`);

  const grid = cells.map((row) =>
    row.map((cell) => {
      const formula = cell.getAttribute(FORMULA_ATTRIBUTE);
      if (formula !== null && shown(cell)) return formula;
      if (formula !== null) forget(cell);
      return (livePreviewCellContent(cell)?.content ?? cell).textContent;
    })
  );

  if (!host.inEditor()) {
    for (const row of cells) for (const cell of row) putBack(cell, shown(cell));
    return;
  }

  const outcomes: Outcome[] = [];
  for (const result of evaluateGrid(grid, host.context())) {
    outcomes.push(result.outcome);
    const cell = cells[result.row]?.[result.col];
    const parts = cell ? livePreviewCellContent(cell) : null;
    // Its editor is open: the person is reading the formula, not the result.
    if (!cell || !parts || parts.editing) continue;

    const text = result.text ?? host.unavailable(result.outcome);
    const formula = cell.getAttribute(FORMULA_ATTRIBUTE) ?? parts.content.textContent.trim();
    const existing = shown(cell);
    if (existing) {
      if (existing.textContent !== text) existing.textContent = text;
    } else {
      placeResult(parts.content, formula, text);
    }
    cell.setAttribute(FORMULA_ATTRIBUTE, formula);
    cell.setAttribute("title", formula);
  }
  if (outcomes.length > 0) host.seen(outcomes);
}

function forget(cell: HTMLTableCellElement): void {
  cell.removeAttribute(FORMULA_ATTRIBUTE);
  cell.removeAttribute("title");
}

/** A cell shows its formula again, where it showed a result. */
function putBack(cell: HTMLTableCellElement, result: HTMLElement | null): void {
  const formula = cell.getAttribute(FORMULA_ATTRIBUTE);
  if (formula === null) return;
  if (result) result.replaceWith(result.ownerDocument.createTextNode(formula));
  forget(cell);
}
