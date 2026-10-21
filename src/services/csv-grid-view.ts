/**
 * What the CSV view shows of a file: which rows a search keeps, in which
 * order, under which columns, and whether a total closes the table.
 *
 * The view never writes back, so all of this is a way of looking. It is kept
 * with the tab, which is why a restored workspace hands it back as data that
 * may have been edited by hand, or written for another file.
 */
import type { NumberFormat } from "./amounts";
import { cellNumber, renderAlignedTable } from "./csv-table";
import type { MarkdownTable } from "./text-to-table";

/** A search longer than this is not typed, it is pasted by mistake. */
export const MAX_QUERY_LENGTH = 200;

export type SortDirection = "asc" | "desc";

export interface CsvSort {
  column: number;
  direction: SortDirection;
}

export interface CsvViewState {
  sort: CsvSort | null;
  /** Rows holding this text in any shown cell, ignoring case; "" keeps all. */
  query: string;
  /** Columns of the file left out, by their place in it. */
  hidden: readonly number[];
  /** Whether a row of `=sum` closes the table. */
  totals: boolean;
}

export const INITIAL_VIEW_STATE: CsvViewState = {
  sort: null,
  query: "",
  hidden: [],
  totals: false
};

/** Anything a workspace file holds, made a state: what does not fit is dropped. */
export function normalizeViewState(raw: unknown): CsvViewState {
  if (typeof raw !== "object" || raw === null) return INITIAL_VIEW_STATE;
  const value = raw as Record<string, unknown>;
  return {
    sort: normalizeSort(value.sort),
    query: typeof value.query === "string" ? value.query.slice(0, MAX_QUERY_LENGTH) : "",
    hidden: Array.isArray(value.hidden)
      ? [...new Set(value.hidden.filter(isColumnIndex))].sort((a, b) => a - b)
      : [],
    totals: value.totals === true
  };
}

function normalizeSort(raw: unknown): CsvSort | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { column, direction } = raw as Record<string, unknown>;
  if (!isColumnIndex(column) || (direction !== "asc" && direction !== "desc")) return null;
  return { column, direction };
}

function isColumnIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * A press on a column's header: up, then down, then the file's own order —
 * the order a spreadsheet export came in often means something, and has to
 * be reachable again without closing the tab.
 */
export function nextSort(current: CsvSort | null, column: number): CsvSort | null {
  if (current?.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

/**
 * A column shown or left out. The last column shown stays: a table of no
 * columns is an empty tab, and the way back to it would be one more menu.
 */
export function toggleHidden(
  hidden: readonly number[],
  column: number,
  columns: number
): readonly number[] {
  if (hidden.includes(column)) return hidden.filter((index) => index !== column);
  const shown = range(columns).filter((index) => !hidden.includes(index));
  if (shown.length <= 1 || !shown.includes(column)) return hidden;
  return [...hidden, column].sort((a, b) => a - b);
}

export interface ShownGrid {
  header: string[];
  rows: string[][];
  numeric: boolean[];
  /** Each shown column's place in the file, which a sort and a hide refer to. */
  columns: number[];
  /** The rows the search kept, of `total`. */
  matched: number;
  total: number;
}

/**
 * The file as the state shows it. Indices a state brought from another file,
 * or from before the file changed, name no column here and are passed over.
 */
export function shownGrid(
  table: MarkdownTable,
  numeric: readonly boolean[],
  state: CsvViewState,
  format: NumberFormat
): ShownGrid {
  const width = table.header.length;
  let columns = range(width).filter((index) => !state.hidden.includes(index));
  // Every column hidden by a state written for a narrower file.
  if (columns.length === 0) columns = range(width);

  const needle = state.query.trim().toLocaleLowerCase();
  const kept = needle
    ? table.rows.filter((row) =>
        columns.some((index) => (row[index] ?? "").toLocaleLowerCase().includes(needle))
      )
    : [...table.rows];

  const sort = state.sort;
  if (sort && sort.column < width) {
    const order = sortOrder(kept, sort, numeric[sort.column] === true, format);
    kept.splice(0, kept.length, ...order);
  }

  return {
    header: columns.map((index) => table.header[index] ?? ""),
    rows: kept.map((row) => columns.map((index) => row[index] ?? "")),
    numeric: columns.map((index) => numeric[index] === true),
    columns,
    matched: kept.length,
    total: table.rows.length
  };
}

/**
 * Numbers by value, text the way the reader's language sorts it, with digits
 * inside text read as numbers (`Haus 2` before `Haus 10`). Empty cells go last
 * either way: a gap at the top of a column sorted down hides what was looked for.
 */
function sortOrder(
  rows: string[][],
  { column, direction }: CsvSort,
  numeric: boolean,
  format: NumberFormat
): string[][] {
  const collator = new Intl.Collator(format.locale, { numeric: true, sensitivity: "base" });
  const sign = direction === "asc" ? 1 : -1;
  const keyed = rows.map((row) => {
    const cell = (row[column] ?? "").trim();
    return { row, cell, number: numeric ? cellNumber(cell, format) : null };
  });
  // Array.prototype.sort is stable, so equal cells keep the file's order.
  keyed.sort((a, b) => {
    if (a.cell === "" || b.cell === "") return (a.cell === "" ? 1 : 0) - (b.cell === "" ? 1 : 0);
    if (a.number !== null && b.number !== null) return sign * (a.number - b.number);
    return sign * collator.compare(a.cell, b.cell);
  });
  return keyed.map(({ row }) => row);
}

/**
 * The row that closes a table with its totals: `**=sum**` under every column
 * of numbers, the label in the first column of text. Written the way a person
 * writes one in a note, so the table copied keeps adding up after an edit.
 * No column of text, no label: a total with nothing to say what it is still
 * reads as one at the foot of the numbers.
 */
export function totalsRow(numeric: readonly boolean[], label: string): string[] | null {
  if (!numeric.includes(true)) return null;
  const labelAt = numeric.indexOf(false);
  return numeric.map((number, index) => {
    if (number) return "**=sum**";
    return index === labelAt ? `**${label}**` : "";
  });
}

/** What the view's copy puts on the clipboard: what is shown, and the total if one is. */
export function shownMarkdown(shown: ShownGrid, totals: readonly string[] | null): string {
  const rows = totals ? [...shown.rows, [...totals]] : shown.rows;
  return renderAlignedTable({ header: shown.header, rows }, shown.numeric);
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}
