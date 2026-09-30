/**
 * A CSV file, read as the Markdown table a person would paste into a note.
 *
 * The selection converter in `text-to-table.ts` reads a few lines someone
 * marked; a file is a different animal. It comes from a spreadsheet, so a cell
 * may hold a line break or a doubled quote, a row may be shorter than the
 * header, and a German Excel writes semicolons because the comma is its
 * decimal point. Everything here decides; reading the file and the clipboard
 * are the controller's.
 */
import type { MarkdownTable } from "./text-to-table";

/** A file above this is refused unread: a table that long is not pasted, it is scrolled. */
export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 2_000;
export const MAX_CSV_COLUMNS = 100;

/**
 * Pipes line up up to this width. Beyond it one paragraph-long cell would push
 * every other row of its column out by the same amount, and the source would
 * read worse than unpadded.
 */
export const MAX_PAD_WIDTH = 60;

/** Tried in this order, so a tie goes to the delimiter that cannot be a decimal point. */
const DELIMITERS = ["\t", ";", ","] as const;

/** How many records decide the delimiter and whether the first row is a header. */
const SAMPLE_RECORDS = 50;

/** Whether a file of this extension is one the explorer offers to copy as a table. */
export function isCsvExtension(extension: string): boolean {
  const ext = extension.toLowerCase();
  return ext === "csv" || ext === "tsv";
}

export type CsvRefusal = "empty" | "malformed" | "too-many-rows" | "too-many-columns";

export type CsvTableOutcome =
  { ok: true; markdown: string; rows: number; columns: number } | { ok: false; reason: CsvRefusal };

/** Invents a header for a file whose first row turned out to be data. */
export type ColumnLabel = (index: number) => string;

const defaultLabel: ColumnLabel = (index) => `Column ${index}`;

export function csvToMarkdown(text: string, label: ColumnLabel = defaultLabel): CsvTableOutcome {
  const source = text.replace(/^\uFEFF/, "");
  if (!source.trim()) return { ok: false, reason: "empty" };

  const records = readRecords(source);
  if (!records) return { ok: false, reason: "malformed" };

  // Folded, not spread: a megabyte of short lines is more arguments than a call takes.
  const width = records.reduce((most, record) => Math.max(most, record.length), 0);
  if (width > MAX_CSV_COLUMNS) return { ok: false, reason: "too-many-columns" };

  const cells = records.map((record) => {
    const row = record.map((cell) => cell.trim());
    while (row.length < width) row.push("");
    return row;
  });

  const [first, ...rest] = cells as [string[], ...string[][]];
  const table: MarkdownTable = looksLikeData(first, rest)
    ? { header: first.map((_, i) => label(i + 1)), rows: cells }
    : { header: first, rows: rest };
  if (table.rows.length > MAX_CSV_ROWS) return { ok: false, reason: "too-many-rows" };

  return {
    ok: true,
    markdown: renderAlignedTable(table),
    rows: table.rows.length,
    columns: width
  };
}

/**
 * The records under the delimiter that explains the file best, blank lines
 * dropped; null when every delimiter leaves a quote open.
 *
 * "Best" is the one under which the most sampled records have as many fields
 * as the first, and then the one with more fields. Semicolon beats comma on a
 * German file for exactly that reason: `3,5;4,25` is two fields under the one
 * and a different number on every line under the other.
 */
function readRecords(text: string): string[][] | null {
  let best: { records: string[][]; score: [number, number] } | null = null;

  for (const delimiter of DELIMITERS) {
    const records = parseCsv(text, delimiter);
    if (!records) continue;
    const kept = records.filter((record) => record.some((cell) => cell.trim() !== ""));
    if (kept.length === 0) continue;

    const sample = kept.slice(0, SAMPLE_RECORDS);
    const fields = sample[0]!.length;
    const score: [number, number] = [
      sample.filter((record) => record.length === fields).length,
      fields
    ];
    // A delimiter that never splits anything explains nothing, and loses to
    // any that does; it still wins over nothing, for a one-column file.
    if (fields === 1) score[0] = 0;
    if (!best || isBetter(score, best.score)) best = { records: kept, score };
  }

  return best?.records ?? null;
}

function isBetter([a1, a2]: [number, number], [b1, b2]: [number, number]): boolean {
  return a1 > b1 || (a1 === b1 && a2 > b2);
}

/**
 * RFC 4180, with the leniency spreadsheets need: a quote opens a quoted field
 * only at its start, so `5" nail` stays a cell rather than swallowing the rest
 * of the file. A quote that opens and never closes does, and returns null.
 */
export function parseCsv(text: string, delimiter: string): string[][] | null {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let atFieldStart = true;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (char === delimiter) {
      record.push(cell);
      cell = "";
      atFieldStart = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
      atFieldStart = true;
    } else {
      // Spaces before an opening quote (`a, "b"`) are what people type.
      if (!(atFieldStart && char === " ")) atFieldStart = false;
      cell += char;
    }
  }

  if (quoted) return null;
  record.push(cell);
  records.push(record);
  return records;
}

/**
 * Whether the first row is data rather than a header.
 *
 * A header is the usual case and the safe guess, so the row has to argue for
 * being data: it must sit in at least one column of numbers as a number itself,
 * and nowhere be text above a column of numbers — that contrast is the surest
 * sign of a header there is. Years are the one trap: `Name;2023;2024` above
 * amounts is a header of numbers, and reads as one when every number in the
 * row is a year and the column below it is not all years.
 */
export function looksLikeData(first: string[], rest: string[][]): boolean {
  let numberUnderNumber = false;
  let yearsOverNonYears = true;

  for (let column = 0; column < first.length; column++) {
    const top = first[column]!;
    const below = rest.map((row) => row[column] ?? "").filter((cell) => cell !== "");
    const numbersBelow = below.length > 0 && below.every(isNumeric);

    if (!isNumeric(top)) {
      if (top !== "" && numbersBelow) return false;
      continue;
    }
    if (rest.length > 0 && !numbersBelow) continue;

    numberUnderNumber = true;
    if (!isYear(top) || (below.length > 0 && below.every(isYear))) yearsOverNonYears = false;
  }

  return numberUnderNumber && !(rest.length > 0 && yearsOverNonYears);
}

const CURRENCY = /^[€$£¥]\s*|\s*(?:[€$£¥%]|EUR|USD|CHF)$/gi;
// Either grouping (`1.234,50`, `1,234.50`, `1 234`) or none (`1234.5`, `3,5`).
const NUMBER = /^[-+−]?(?:\d{1,3}(?:([.,\u00A0\u202F ])\d{3})*(?:(?!\1)[.,]\d+)?|\d+(?:[.,]\d+)?)$/;

export function isNumeric(cell: string): boolean {
  const bare = cell.trim().replace(CURRENCY, "");
  return bare !== "" && NUMBER.test(bare);
}

function isYear(cell: string): boolean {
  if (!/^\d{4}$/.test(cell)) return false;
  const year = Number(cell);
  return year >= 1900 && year <= 2100;
}

/**
 * A pipe table whose pipes line up in the source, with columns of numbers
 * set flush right, the way a spreadsheet shows them.
 */
export function renderAlignedTable({ header, rows }: MarkdownTable): string {
  const head = header.map(asCell);
  const body = rows.map((row) => row.map(asCell));
  const right = head.map((_, column) => {
    const values = rows.map((row) => row[column] ?? "").filter((cell) => cell.trim() !== "");
    return values.length > 0 && values.every(isNumeric);
  });
  const widths = head.map((cell, column) =>
    Math.min(
      MAX_PAD_WIDTH,
      Math.max(3, length(cell), ...body.map((row) => length(row[column] ?? "")))
    )
  );

  const pad = (cell: string, column: number) => {
    const fill = " ".repeat(Math.max(0, widths[column]! - length(cell)));
    return right[column] ? fill + cell : cell + fill;
  };
  const line = (cells: string[]) => `| ${cells.map(pad).join(" | ")} |`;
  const rule = widths.map((width, column) =>
    right[column] ? "-".repeat(width - 1) + ":" : "-".repeat(width)
  );

  return [line(head), `| ${rule.join(" | ")} |`, ...body.map(line)].join("\n");
}

/** A cell that cannot break the table: no pipe ends it, no line break ends the row. */
function asCell(cell: string): string {
  return cell
    .trim()
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, "<br>");
}

/** Code points, not UTF-16 units, so an umlaut or an emoji counts as one. */
function length(cell: string): number {
  return [...cell].length;
}
