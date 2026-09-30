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
import { escapeCell } from "./markdown-table";
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

  const read = readRecords(source);
  if ("refusal" in read) return { ok: false, reason: read.refusal };
  const { records } = read;

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

type ReadRecords = { records: string[][] } | { refusal: CsvRefusal };

/**
 * The records under the delimiter that explains the file best, read no
 * further than the row limit needs.
 *
 * The delimiter is decided on the first records alone, then the file is read
 * once under it: a megabyte refused for its length is not first split three
 * times over. "Best" is the delimiter under which the most sampled records
 * share one field count, and then the one with more fields. Semicolon beats
 * comma on a German file for exactly that reason: `3,5;4,25` is two fields
 * under the one and a different number on every line under the other.
 */
function readRecords(text: string): ReadRecords {
  let best: { delimiter: string; fields: number; score: [number, number]; lead: number } | null =
    null;
  let unclosed = false;

  for (const delimiter of DELIMITERS) {
    const sample = parseCsv(text, delimiter, SAMPLE_RECORDS);
    if (!sample) {
      unclosed = true;
      continue;
    }
    // Nothing but this delimiter and blanks: an empty sheet, as Excel saves one.
    if (sample.length === 0) return { refusal: "empty" };

    const [fields, count] = commonestWidth(sample);
    // A delimiter that never splits anything explains nothing, and loses to
    // any that does; it still wins over nothing, for a one-column file.
    const score: [number, number] = [fields === 1 ? 0 : count, fields];
    if (!best || isBetter(score, best.score)) {
      best = { delimiter, fields, score, lead: preambleLength(sample, fields) };
    }
  }

  if (!best) return { refusal: unclosed ? "malformed" : "empty" };
  // A quote only opens a field at its start, so which quote opens depends on
  // the delimiter. When the one that fits leaves a quote open, the others read
  // that quote as text and split nothing: a column of raw lines, not a table.
  if (unclosed && best.fields === 1) return { refusal: "malformed" };

  // The header, the rows allowed and one more: reaching that many is enough to
  // know there are too many, whichever way the header guess goes.
  const limit = best.lead + MAX_CSV_ROWS + 2;
  const records = parseCsv(text, best.delimiter, limit);
  if (!records) return { refusal: "malformed" };
  if (records.length >= limit) return { refusal: "too-many-rows" };
  return { records: records.slice(best.lead) };
}

/** The field count most sampled records share, the wider on a tie, and how many share it. */
function commonestWidth(sample: string[][]): [number, number] {
  const counts = new Map<number, number>();
  for (const record of sample) counts.set(record.length, (counts.get(record.length) ?? 0) + 1);
  let best: [number, number] = [0, 0];
  for (const [fields, count] of counts) {
    if (isBetter([count, fields], [best[1], best[0]])) best = [fields, count];
  }
  return best;
}

/**
 * The lines of one cell above a table of several: the title or date line a
 * bank or an accounting export puts before its header, which is not a row.
 */
function preambleLength(sample: string[][], fields: number): number {
  if (fields === 1) return 0;
  const lead = sample.findIndex((record) => record.length > 1);
  return Math.max(0, lead);
}

function isBetter([a1, a2]: [number, number], [b1, b2]: [number, number]): boolean {
  return a1 > b1 || (a1 === b1 && a2 > b2);
}

/**
 * RFC 4180, with the leniency spreadsheets need: a quote opens a quoted field
 * only at its start, so `5" nail` stays a cell rather than swallowing the rest
 * of the file. A quote that opens and never closes does, and returns null.
 *
 * Blank lines are no records. Reading stops after `limit` records, so a caller
 * that needs the first few does not pay for the whole file.
 */
export function parseCsv(text: string, delimiter: string, limit = Infinity): string[][] | null {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let atFieldStart = true;

  const endRecord = () => {
    record.push(cell);
    if (record.some((value) => value.trim() !== "")) records.push(record);
    record = [];
    cell = "";
    atFieldStart = true;
  };

  for (let i = 0; i < text.length && records.length < limit; i++) {
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
      endRecord();
    } else {
      // Spaces before an opening quote (`a, "b"`) are what people type.
      if (!(atFieldStart && char === " ")) atFieldStart = false;
      cell += char;
    }
  }

  if (quoted) return null;
  if (records.length < limit) endRecord();
  return records;
}

/**
 * Whether the first row is data rather than a header.
 *
 * A header is the usual case and the safe guess, so the row has to argue for
 * being data: it must sit in at least one column of numbers as a number itself,
 * and nowhere be text above a column of numbers — that contrast is the surest
 * sign of a header there is. Years are the one trap: `Name;2023;2024` above
 * amounts is a header of numbers. It reads as one when its numbers are two or
 * more years in a row, over columns that are not years. A single number in the
 * range of years is not enough: `Miete;1950` is a rent, not a heading.
 */
export function looksLikeData(first: string[], rest: string[][]): boolean {
  const numbersOverNumbers: string[] = [];
  let yearsBelow = false;

  for (let column = 0; column < first.length; column++) {
    const top = first[column]!;
    const below = rest.map((row) => row[column] ?? "").filter((cell) => cell !== "");
    const numbersBelow = below.length > 0 && below.every(isNumeric);

    if (!isNumeric(top)) {
      if (top !== "" && numbersBelow) return false;
      continue;
    }
    if (rest.length > 0 && !numbersBelow) continue;

    numbersOverNumbers.push(top);
    if (below.length > 0 && below.every(isYear)) yearsBelow = true;
  }

  if (numbersOverNumbers.length === 0) return false;
  return rest.length === 0 || yearsBelow || !isYearRun(numbersOverNumbers);
}

/** Two or more years, each the one after the last: the columns of a comparison. */
function isYearRun(cells: string[]): boolean {
  return (
    cells.length >= 2 &&
    cells.every(isYear) &&
    cells.every((cell, i) => i === 0 || Number(cell) === Number(cells[i - 1]) + 1)
  );
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

/**
 * A cell that cannot break the table, in composed form: a decomposed umlaut,
 * as a Mac or a PDF writes it, would count as two and push its pipe out.
 */
function asCell(cell: string): string {
  return escapeCell(cell.trim().normalize("NFC"));
}

const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;

/**
 * What a reader sees as one character: a flag or an emoji built of several is
 * one. Code points where the platform cannot segment, which is off only for
 * those. A wide character still takes two columns of a monospace font and one
 * here; the pipes beside Chinese text do not line up.
 */
function length(cell: string): number {
  if (!graphemes) return [...cell].length;
  let count = 0;
  for (const _ of graphemes.segment(cell)) count++;
  return count;
}
