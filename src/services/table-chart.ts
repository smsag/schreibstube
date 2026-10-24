/**
 * A chart drawn from a Markdown table: what its columns hold, which one or
 * two charts suit them, and the Mermaid block that draws each.
 *
 * The chart is a picture of the table at the moment it was made. Nothing ties
 * the two together afterwards: a block that read the table would need this
 * plugin to be drawn, and a Mermaid block is drawn by Obsidian, a print, a
 * mail and a published page alike. Making the chart again replaces the one
 * made before, which is what the marker on its first line is for.
 *
 * Amounts are read the way the sums read them, so a table that adds up in the
 * status bar charts with the same numbers. A row the chart cannot show is
 * left out and counted in its title, so the picture never claims more of
 * the table than it holds.
 */
import { CURRENCY_CODES, readCell, type Amount, type NumberFormat } from "./amounts";
import { closesFence, fenceLanguage, fenceMarker, fencedLines } from "./markdown-fence";
import { isTableDelimiter, rowCells } from "./markdown-table";
import { parseFormula } from "./table-formulas";

/** The first line of every chart this makes, so making it again finds it. */
export const CHART_MARKER = "%% schreibstube chart";

/** Past this, a table is a dataset rather than a note's table, and is not read. */
export const MAX_CHART_ROWS = 5_000;
/** Rows the menu reads to decide whether to offer a chart at all. */
export const MENU_SAMPLE_ROWS = 200;
/** More slices than this and a pie is unreadable: the rest become one. */
export const MAX_PIE_SLICES = 8;
/** Bars for categories; the rest are added up into one. */
export const MAX_BARS = 12;
/** Periods on a time axis; more and the chart moves to a coarser period. */
export const MAX_PERIODS = 24;
/** Values of a column past which it is a list of descriptions, not of groups. */
export const MAX_GROUPS = 200;
const MAX_LABEL_CHARS = 40;
/** Text cells longer than this on average are descriptions, not groups. */
const MAX_GROUP_LABEL_AVERAGE = 40;

/** Share of a column's filled cells that must read as amounts or dates. */
const AMOUNT_SHARE = 0.8;
const DATE_SHARE = 0.9;

/** A table's lines in a note, header to last row, both inclusive. */
export interface TableLines {
  from: number;
  to: number;
}

/** A table's cells, as plain text. */
export interface PlainTable {
  header: string[];
  rows: string[][];
}

/** The words a chart is labelled with, in the reader's language. */
export interface ChartLabels {
  other: string;
  byGroup: (value: string, group: string) => string;
  byGroups: (value: string, outer: string, inner: string) => string;
  perDay: (value: string) => string;
  perMonth: (value: string) => string;
  perYear: (value: string) => string;
  /** A title for a chart that leaves rows of its table out. */
  without: (title: string, rows: number) => string;
}

export type ChartKind = "time" | "pie" | "bars" | "treemap";

export interface ChartSuggestion {
  kind: ChartKind;
  title: string;
  /** The Mermaid source, marker first, without the fence. */
  source: string;
}

/** Why a table offers no chart, for the command to say. */
export type ChartRefusal =
  "no-table" | "too-long" | "no-amounts" | "no-groups" | "mixed-currencies";

export type ChartOffer =
  | {
      ok: true;
      table: TableLines;
      /** The table's lines as they were read, so the chart goes only above that table. */
      tableText: string[];
      suggestions: ChartSuggestion[];
      replaces: TableLines | null;
    }
  | { ok: false; reason: ChartRefusal };

/**
 * The table a selection is in: the first selected line that is a table row,
 * widened to the whole table. A table needs its header, the delimiter under
 * it and at least one row; a line in a code block is never one.
 */
export function tableAt(lines: readonly string[], first: number, last: number): TableLines | null {
  const fenced = fencedLines(lines);
  const isRow = (line: number): boolean => {
    const text = lines[line];
    return text !== undefined && !fenced[line] && text.includes("|") && text.trim() !== "";
  };
  const end = Math.min(last, lines.length - 1);
  for (let line = Math.max(0, first); line <= end; line++) {
    if (!isRow(line)) continue;
    let from = line;
    while (from > 0 && isRow(from - 1)) from--;
    let to = line;
    while (to + 1 < lines.length && isRow(to + 1)) to++;
    const delimiter = lines[from + 1];
    if (delimiter !== undefined && isTableDelimiter(delimiter) && to >= from + 2) {
      return { from, to };
    }
    // Lines with pipes that make no table; the selection may reach a table further down.
    line = to;
  }
  return null;
}

/**
 * The table's cells as plain text, every row as wide as the header. A row
 * with a formula cell is the table's total, and charting it would count the
 * table twice; an empty row says nothing.
 */
export function readTable(lines: readonly string[], at: TableLines): PlainTable {
  const header = rowCells(lines[at.from] ?? "").map(plainText);
  const rows: string[][] = [];
  for (let line = at.from + 2; line <= at.to; line++) {
    const cells = rowCells(lines[line] ?? "");
    if (cells.some((cell) => parseFormula(cell) !== null)) continue;
    const row = header.map((_, index) => plainText(cells[index] ?? ""));
    if (row.every((cell) => cell === "")) continue;
    rows.push(row);
  }
  return { header, rows };
}

/**
 * A cell as it reads: the words a link or a formatting mark stands around,
 * without the marks.
 */
export function plainText(cell: string): string {
  return cell
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]*)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\|`*_[\]])/g, "$1")
    .replace(/(\*\*|__|~~|==|`)/g, "")
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Columns ─────────────────────────────────────────────────────────────────

interface Day {
  year: number;
  month: number;
  day: number;
}

type Column =
  | { kind: "amount"; index: number; name: string; currency: string | null; mixed: boolean }
  | { kind: "date"; index: number; name: string; dayFirst: boolean; yearsOnly: boolean }
  | { kind: "text"; index: number; name: string; groups: number; average: number }
  | { kind: "empty"; index: number; name: string };

type AmountColumn = Extract<Column, { kind: "amount" }>;
type DateColumn = Extract<Column, { kind: "date" }>;
type TextColumn = Extract<Column, { kind: "text" }>;

/** A day, with a time after it or not, or a month: `2026-03-15T10:00`, `2026-03`. */
const ISO_DATE =
  /^(\d{4})-(\d\d?)(?:-(\d\d?)(?:[T ]\d\d?:\d\d(?::\d\d(?:[.,]\d+)?)?(?:\s?(?:Z|[+-]\d\d:?\d\d))?)?)?$/;
const DOTTED_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/;
const SLASHED_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

/**
 * A date as a table writes one: `2026-03-15`, `15.03.2026`, `15.03.26`,
 * `2026-03` for a month, and `15/03/2026` or `03/15/2026` — which of those
 * two the slashes mean is the column's to say, not the cell's.
 */
export function readDate(text: string, dayFirst: boolean): Day | null {
  const iso = ISO_DATE.exec(text);
  if (iso) return day(Number(iso[1]), Number(iso[2]), iso[3] ? Number(iso[3]) : 1);
  const dotted = DOTTED_DATE.exec(text);
  if (dotted) return day(fullYear(dotted[3]!), Number(dotted[2]), Number(dotted[1]));
  const slashed = SLASHED_DATE.exec(text);
  if (!slashed) return null;
  const [a, b] = [Number(slashed[1]), Number(slashed[2])];
  return dayFirst ? day(fullYear(slashed[3]!), b, a) : day(fullYear(slashed[3]!), a, b);
}

/**
 * Which way a column writes its slashed dates. A column is written one way,
 * so one cell with a day above twelve settles it for every cell; without
 * one, the number format does — a comma for decimals writes the day first.
 * A column written both ways is null: no column of dates at all. Read cell
 * by cell, `03/04` and `15/04` would be two months apart in the same table.
 */
export function slashOrder(cells: readonly string[], fallback: boolean): boolean | null {
  let dayFirst = false;
  let monthFirst = false;
  for (const cell of cells) {
    const slashed = SLASHED_DATE.exec(cell);
    if (!slashed) continue;
    if (Number(slashed[1]) > 12) dayFirst = true;
    if (Number(slashed[2]) > 12) monthFirst = true;
  }
  if (dayFirst && monthFirst) return null;
  return dayFirst ? true : monthFirst ? false : fallback;
}

function fullYear(written: string): number {
  return written.length === 2 ? 2000 + Number(written) : Number(written);
}

function day(year: number, month: number, date: number): Day | null {
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  const real = new Date(Date.UTC(year, month - 1, date));
  return real.getUTCMonth() === month - 1 ? { year, month, day: date } : null;
}

/**
 * A cell that is a figure and nothing else: digits, separators, a sign and a
 * currency. `Shop 12` holds a number but is a name, and a column of names
 * read as amounts would chart the shop numbers. Parentheses are not a sign
 * here: an accountant's `(12.50)` is a loss, and read as a gain it would be
 * charted the wrong way up.
 */
export function isFigure(cell: string): boolean {
  const rest = cell
    .replace(CURRENCY_WORDS, "")
    .replace(/R\$|\p{Sc}|zł|Kč/gu, "")
    .replace(/[\d\s.,'’+\-−]/g, "");
  return /\d/.test(cell) && rest === "";
}

const CURRENCY_WORDS = new RegExp(`\\b(?:${CURRENCY_CODES.join("|")})\\b`, "g");

/** A column of whole numbers between these, with no currency and a name like it, counts years. */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2100;

function isYear(amount: Amount): boolean {
  return (
    amount.currency === null &&
    amount.decimals === 0 &&
    amount.value >= FIRST_YEAR &&
    amount.value <= LAST_YEAR
  );
}

/**
 * The words below end the column's name, in the singular or the plural, but
 * may start it anywhere: `Kaufpreis` and `Nebenkosten` are amounts,
 * `Wertpapier` and `Consumer` are not.
 */
const ENDING = String.raw`(?:e|n|en|s|es)?\b`;
/** A column named like what is spent, earned or counted. */
const AMOUNT_WORDS = new RegExp(
  `(?:betr[aä]g|summe|preis|kosten|ausgabe|einnahme|ums[aä]tz|wert|amount|sum|price|cost|expense|spend(?:ing)?|income|revenue|value|total)${ENDING}`,
  "i"
);
/** A running balance adds up to nothing meaningful. */
const BALANCE_WORDS = new RegExp(`(?:saldo|kontostand|bestand|balance)${ENDING}`, "i");
/** A column named like the groups a table falls into. */
const GROUP_WORDS = new RegExp(
  `(?:kategorie|art|typ|gruppe|bereich|category|categories|kind|type|group|class)${ENDING}`,
  "i"
);
/** A column named like years: `Jahr`, `Baujahr`, `Fiscal year`, `FY` — not `Jahresbeitrag`. */
const YEAR_WORDS = /(?:jahr|year)\b|\bfy\b/i;
/**
 * A column that names or numbers its rows rather than measuring them: a row
 * number, an ID, a postcode. Its figures add up to nothing anyone means.
 */
const IDENTIFIER_WORDS =
  /(?:^#|\b(?:nr|no|id|pos|plz|zip|tel)\.?|nummer|number|index|rang|rank|postleitzahl|postcode|telefon|phone)$/i;

const SAYS = /[\p{L}\p{N}]/u;

function profile(table: PlainTable, format: NumberFormat): Column[] {
  return table.header.map((name, index): Column => {
    // A dash fills a cell to say there is nothing in it.
    const cells = table.rows.map((row) => row[index] ?? "").filter((cell) => SAYS.test(cell));
    if (cells.length === 0) return { kind: "empty", index, name };
    const dayFirst = slashOrder(cells, format.decimal === ",");
    if (dayFirst !== null) {
      const dates = cells.filter((cell) => readDate(cell, dayFirst) !== null).length;
      if (dates >= cells.length * DATE_SHARE) {
        return { kind: "date", index, name, dayFirst, yearsOnly: false };
      }
    }

    const amounts = cells.flatMap((cell) => {
      const reading = isFigure(cell) ? readCell(cell, format) : null;
      return reading?.kind === "amount" ? [reading.amount] : [];
    });
    if (amounts.length < cells.length * AMOUNT_SHARE) {
      const average = cells.reduce((sum, cell) => sum + cell.length, 0) / cells.length;
      return { kind: "text", index, name, groups: new Set(cells).size, average };
    }
    // Only its name makes a column of years: a count of 1950 is a count.
    if (YEAR_WORDS.test(name) && amounts.length === cells.length && amounts.every(isYear)) {
      return { kind: "date", index, name, dayFirst: false, yearsOnly: true };
    }
    const currencies = new Set(
      amounts.flatMap((amount) => (amount.currency ? [amount.currency] : []))
    );
    return {
      kind: "amount",
      index,
      name,
      currency: currencies.size === 1 ? [...currencies][0]! : null,
      mixed: currencies.size > 1
    };
  });
}

/** The rows numbered 1, 2, 3 … in order: a numbering, whatever its column is called. */
function numbersRows(table: PlainTable, index: number): boolean {
  return table.rows.length >= 3 && table.rows.every((row, at) => row[index] === String(at + 1));
}

function valueColumn(table: PlainTable, columns: Column[]): AmountColumn | "mixed" | null {
  const amounts = columns.filter(
    (column): column is AmountColumn =>
      column.kind === "amount" &&
      !BALANCE_WORDS.test(column.name) &&
      !IDENTIFIER_WORDS.test(column.name) &&
      !numbersRows(table, column.index)
  );
  if (amounts.length === 0) return null;
  const usable = amounts.filter((column) => !column.mixed);
  if (usable.length === 0) return "mixed";
  const score = (column: AmountColumn): number =>
    (AMOUNT_WORDS.test(column.name) ? 2 : 0) + (column.currency ? 1 : 0);
  // A tie goes to the column further right: a table names its rows first and
  // puts what they cost last, so a quantity stands before the price.
  return usable.reduce((best, column) => (score(column) >= score(best) ? column : best));
}

/** The text columns worth grouping by, the likeliest first. */
function groupColumns(columns: Column[]): TextColumn[] {
  const texts = columns.filter(
    (column): column is TextColumn =>
      column.kind === "text" &&
      column.groups >= 2 &&
      column.groups <= MAX_GROUPS &&
      column.average <= MAX_GROUP_LABEL_AVERAGE
  );
  return [...texts].sort(
    (a, b) =>
      Number(GROUP_WORDS.test(b.name)) - Number(GROUP_WORDS.test(a.name)) || a.groups - b.groups
  );
}

// ── Suggestions ─────────────────────────────────────────────────────────────

interface Entry {
  value: number;
  row: string[];
}

/** What a chart is drawn from: the rows it shows, and how many it leaves out. */
interface Drawn {
  entries: Entry[];
  leftOut: number;
  /** The value column's name, short enough to stand in a title. */
  name: string;
  /** The same with its currency, for the value axis. */
  axisName: string;
}

/**
 * The one or two charts that suit a table, the likeliest first: over time when
 * it has dates, by group when it has a column to group by, and a treemap when
 * it has two of those and no dates.
 */
export function suggestCharts(
  table: PlainTable,
  format: NumberFormat,
  labels: ChartLabels
): { ok: true; suggestions: ChartSuggestion[] } | { ok: false; reason: ChartRefusal } {
  if (table.rows.length > MAX_CHART_ROWS) return { ok: false, reason: "too-long" };
  const columns = profile(table, format);
  const value = valueColumn(table, columns);
  if (value === "mixed") return { ok: false, reason: "mixed-currencies" };
  if (!value) return { ok: false, reason: "no-amounts" };

  // Only a figure is charted. `ca. 40 €` reads as some number, but maybe not
  // the one meant, and a chart that adds it in is wrong without saying so.
  let unread = 0;
  const read: Entry[] = [];
  for (const row of table.rows) {
    const cell = row[value.index] ?? "";
    const reading = readCell(cell, format);
    // Nothing, a dash, or an amount quoted to be left out, as the sums leave it out.
    if (reading.kind === "empty" || reading.kind === "quoted") continue;
    if (reading.kind === "unreadable" || !isFigure(cell)) unread++;
    else if (reading.amount.value !== 0) read.push({ value: reading.amount.value, row });
  }
  if (read.length === 0) return { ok: false, reason: "no-amounts" };

  // A chart shows one sign. Mermaid draws a bar from the bottom of its axis,
  // not from zero, so a negative bar grows from below every other one, and a
  // pie has no slice for less than nothing. It shows the sign most rows have
  // — what went out, on a statement that writes it as negative, drawn as
  // positive — and the title says how many rows of the other it leaves out.
  const negative = read.filter((entry) => entry.value < 0);
  const positive = read.filter((entry) => entry.value > 0);
  const weight = (list: Entry[]): number => list.reduce((sum, e) => sum + Math.abs(e.value), 0);
  const spending =
    negative.length > positive.length ||
    (negative.length === positive.length && weight(negative) > weight(positive));
  const name = shorten(clean(value.name));
  const drawn: Drawn = {
    entries: spending ? negative.map((entry) => ({ ...entry, value: -entry.value })) : positive,
    leftOut: unread + (spending ? positive.length : negative.length),
    name,
    axisName: shorten(clean(value.currency ? `${value.name} (${value.currency})` : value.name))
  };

  const suggestions: ChartSuggestion[] = [];
  const date = columns.find((column): column is DateColumn => column.kind === "date");
  if (date) {
    const time = timeChart(drawn, date, format, labels);
    if (time) suggestions.push(time);
  }
  const [outer, inner] = groupColumns(columns);
  if (outer) suggestions.push(groupChart(drawn, outer, labels));
  if (!date && outer && inner) {
    // The column with fewer values is the outer one, whatever their order.
    const [big, small] = outer.groups <= inner.groups ? [outer, inner] : [inner, outer];
    suggestions.push(treemapChart(drawn, big, small, labels));
  }
  if (suggestions.length === 0) return { ok: false, reason: "no-groups" };
  return { ok: true, suggestions: suggestions.slice(0, 2) };
}

function titled(title: string, leftOut: number, labels: ChartLabels): string {
  return leftOut > 0 ? labels.without(title, leftOut) : title;
}

function dateOf(cell: string, column: DateColumn, format: NumberFormat): Day | null {
  if (!column.yearsOnly) return readDate(cell, column.dayFirst);
  const reading = readCell(cell, format);
  if (reading.kind !== "amount" || !isYear(reading.amount)) return null;
  return { year: reading.amount.value, month: 1, day: 1 };
}

function timeChart(
  drawn: Drawn,
  column: DateColumn,
  format: NumberFormat,
  labels: ChartLabels
): ChartSuggestion | null {
  const dated = drawn.entries.flatMap((entry) => {
    const when = dateOf(entry.row[column.index] ?? "", column, format);
    return when ? [{ when, value: entry.value }] : [];
  });
  if (dated.length === 0) return null;

  const ordinal = (when: Day): number => Date.UTC(when.year, when.month - 1, when.day) / 86_400_000;
  const first = dated.reduce((a, b) => (ordinal(b.when) < ordinal(a.when) ? b : a)).when;
  const last = dated.reduce((a, b) => (ordinal(b.when) > ordinal(a.when) ? b : a)).when;
  const months = (last.year - first.year) * 12 + (last.month - first.month) + 1;
  const days = ordinal(last) - ordinal(first) + 1;
  const period: "day" | "month" | "year" = column.yearsOnly
    ? "year"
    : days <= 31 && months <= 2
      ? "day"
      : months <= MAX_PERIODS
        ? "month"
        : "year";

  // Every period from the first to the last, the empty ones too: a gap in a
  // time axis would read as a month that never happened.
  const keys: number[] = [];
  const keyOf = (when: Day): number =>
    period === "day"
      ? ordinal(when)
      : period === "month"
        ? when.year * 12 + when.month - 1
        : when.year;
  for (let key = keyOf(first); key <= keyOf(last); key++) keys.push(key);
  if (keys.length < 2 || keys.length > MAX_PERIODS * 2) return null;
  const sums = new Map(keys.map((key) => [key, 0]));
  for (const { when, value } of dated) sums.set(keyOf(when), (sums.get(keyOf(when)) ?? 0) + value);

  const dates = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(format.locale, { ...options, timeZone: "UTC" });
  const dayLabel = dates({ day: "2-digit", month: "2-digit" });
  const monthLabel = dates({ month: "short", year: "2-digit" });
  const label = (key: number): string =>
    period === "day"
      ? dayLabel.format(new Date(key * 86_400_000))
      : period === "month"
        ? monthLabel.format(new Date(Date.UTC(Math.floor(key / 12), key % 12, 1)))
        : String(key);

  const per =
    period === "day" ? labels.perDay : period === "month" ? labels.perMonth : labels.perYear;
  // A row without a date has no place on the axis: one more left out.
  const title = titled(
    per(drawn.name),
    drawn.leftOut + drawn.entries.length - dated.length,
    labels
  );
  return {
    kind: "time",
    title,
    source: [
      CHART_MARKER,
      "xychart-beta",
      `    title ${quote(title)}`,
      `    x-axis [${keys.map((key) => quote(clean(label(key)))).join(", ")}]`,
      `    y-axis ${quote(drawn.axisName)} ${axisRange(keys.map((key) => sums.get(key) ?? 0))}`,
      `    bar [${keys.map((key) => figure(sums.get(key) ?? 0)).join(", ")}]`
    ].join("\n")
  };
}

/** The sum per value of a column, largest first. An empty cell is a group of its own. */
function sumsBy(entries: Entry[], index: number): [string, number][] {
  const sums = new Map<string, number>();
  for (const entry of entries) {
    const group = entry.row[index] || "–";
    sums.set(group, (sums.get(group) ?? 0) + entry.value);
  }
  return [...sums.entries()].sort((a, b) => b[1] - a[1]);
}

/** The sums per value of a column, largest first, the tail added up as `other`. */
function grouped(entries: Entry[], index: number, keep: number, other: string): [string, number][] {
  const sorted = sumsBy(entries, index);
  if (sorted.length <= keep) return sorted;
  const rest = sorted.slice(keep - 1).reduce((sum, [, value]) => sum + value, 0);
  return [...sorted.slice(0, keep - 1), [other, rest]];
}

function groupChart(drawn: Drawn, column: TextColumn, labels: ChartLabels): ChartSuggestion {
  const title = titled(
    labels.byGroup(drawn.name, shorten(clean(column.name))),
    drawn.leftOut,
    labels
  );
  const pie = sumsBy(drawn.entries, column.index);
  if (pie.length <= MAX_PIE_SLICES) {
    const names = uniqueLabels(pie.map(([group]) => group));
    return {
      kind: "pie",
      title,
      // A pie's title is the rest of its line; quotes would be drawn as written.
      source: [
        CHART_MARKER,
        "pie showData",
        `    title ${clean(title)}`,
        ...pie.map(([, value], at) => `    ${quote(names[at]!)} : ${figure(value)}`)
      ].join("\n")
    };
  }
  const bars = grouped(drawn.entries, column.index, MAX_BARS, labels.other);
  const names = uniqueLabels(bars.map(([group]) => group));
  return {
    kind: "bars",
    title,
    source: [
      CHART_MARKER,
      "xychart-beta horizontal",
      `    title ${quote(title)}`,
      `    x-axis [${names.map(quote).join(", ")}]`,
      `    y-axis ${quote(drawn.axisName)} ${axisRange(bars.map(([, value]) => value))}`,
      `    bar [${bars.map(([, value]) => figure(value)).join(", ")}]`
    ].join("\n")
  };
}

function treemapChart(
  drawn: Drawn,
  outer: TextColumn,
  inner: TextColumn,
  labels: ChartLabels
): ChartSuggestion {
  const title = titled(
    labels.byGroups(drawn.name, shorten(clean(outer.name)), shorten(clean(inner.name))),
    drawn.leftOut,
    labels
  );
  const lines = [CHART_MARKER, "treemap-beta", quote(title)];
  const sorted = sumsBy(drawn.entries, outer.index);
  const named = sorted.length <= MAX_BARS ? sorted : sorted.slice(0, MAX_BARS - 1);
  const shown = new Set(named.map(([group]) => group));
  const tiles: [string, Entry[]][] = named.map(([group]) => [
    group,
    drawn.entries.filter((entry) => (entry.row[outer.index] || "–") === group)
  ]);
  const rest = drawn.entries.filter((entry) => !shown.has(entry.row[outer.index] || "–"));
  if (rest.length > 0) tiles.push([labels.other, rest]);
  const names = uniqueLabels(tiles.map(([group]) => group));
  tiles.forEach(([, members], at) => {
    lines.push(`    ${quote(names[at]!)}`);
    const parts = grouped(members, inner.index, MAX_BARS, labels.other);
    const partNames = uniqueLabels(parts.map(([member]) => member));
    parts.forEach(([, value], part) => {
      lines.push(`        ${quote(partNames[part]!)}: ${figure(value)}`);
    });
  });
  return { kind: "treemap", title, source: lines.join("\n") };
}

/** Text as Mermaid reads it inside quotes: on one line, with none inside. */
function clean(text: string): string {
  return text.replace(/"/g, "'").replace(/\s+/g, " ").trim();
}

function shorten(text: string, chars = MAX_LABEL_CHARS): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
}

function quote(text: string): string {
  return `"${text}"`;
}

/**
 * Labels short enough to draw, and no two alike. Mermaid keys a slice and a
 * tile by its label: shortened to the same words, two groups would be drawn
 * as one, and a group that is itself called `Other` would swallow the rest.
 * The later one is numbered instead.
 */
export function uniqueLabels(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    const flat = clean(name);
    let label = shorten(flat);
    for (let count = 2; seen.has(label); count++) {
      const suffix = ` (${count})`;
      label = `${shorten(flat, MAX_LABEL_CHARS - suffix.length)}${suffix}`;
    }
    seen.add(label);
    return label;
  });
}

/**
 * The value axis from zero to a round number past the largest bar. Mermaid
 * starts the axis at the smallest bar otherwise, and a bar of 1058 next to
 * one of 1069 then looks like nothing next to something.
 */
export function axisRange(values: readonly number[]): string {
  const high = Math.max(0, ...values);
  return `0 --> ${figure(high > 0 ? roundUp(high) : 1)}`;
}

/** Round steps within a power of ten: fine enough that the top bar fills most of the axis. */
const AXIS_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The next round step at or above a value. */
function roundUp(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const step = AXIS_STEPS.find((factor) => factor * power >= value) ?? 10;
  return step * power;
}

/** A number as Mermaid reads one: a point for decimals, cents at most. */
function figure(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// ── Placing it ──────────────────────────────────────────────────────────────

/**
 * Everything the command needs from a note and a selection: the table, the
 * charts it offers, and a chart this made before, right above the table, that
 * the new one replaces. The charts are drawn from the first `rows` rows.
 */
export function chartOffer(
  lines: readonly string[],
  first: number,
  last: number,
  format: NumberFormat,
  labels: ChartLabels,
  rows = MAX_CHART_ROWS
): ChartOffer {
  const table = tableAt(lines, first, last);
  if (!table) return { ok: false, reason: "no-table" };
  if (table.to - table.from - 1 > MAX_CHART_ROWS) return { ok: false, reason: "too-long" };
  const read = { from: table.from, to: Math.min(table.to, table.from + 1 + rows) };
  const result = suggestCharts(readTable(lines, read), format, labels);
  if (!result.ok) return result;
  return {
    ok: true,
    table,
    tableText: lines.slice(table.from, table.to + 1),
    suggestions: result.suggestions,
    replaces: chartAbove(lines, table.from)
  };
}

/**
 * Whether to offer a chart for a selection, judged from the table's first
 * rows. The menu is built on every right-click; a table of thousands of rows
 * is read in full only once the chart is asked for, and if its later rows
 * change the answer, the command says so then.
 */
export function mayChart(
  lines: readonly string[],
  first: number,
  last: number,
  format: NumberFormat,
  labels: ChartLabels
): boolean {
  return chartOffer(lines, first, last, format, labels, MENU_SAMPLE_ROWS).ok;
}

/**
 * The chart this made above a table, fence to fence, when only blank lines
 * stand between it and the table. A Mermaid block someone wrote has no marker
 * and is left alone.
 */
export function chartAbove(lines: readonly string[], tableFrom: number): TableLines | null {
  let close = tableFrom - 1;
  while (close >= 0 && lines[close]!.trim() === "") close--;
  // Fences pair from the top of the note, the way they are drawn: walked
  // backwards, a fence quoted inside a block would pass for its opening.
  let open: { line: number; marker: string } | null = null;
  for (let line = 0; line <= close; line++) {
    const marker = fenceMarker(lines[line]!);
    if (!marker) continue;
    if (!open) {
      open = { line, marker };
    } else if (closesFence(lines[line]!, open.marker)) {
      if (line === close) {
        const chart =
          fenceLanguage(lines[open.line]!, open.marker) === "mermaid" &&
          lines[open.line + 1]?.trim() === CHART_MARKER;
        return chart ? { from: open.line, to: close } : null;
      }
      open = null;
    }
  }
  return null;
}

/** The fenced block for a chart. */
export function chartBlock(suggestion: ChartSuggestion): string {
  return `\`\`\`mermaid\n${suggestion.source}\n\`\`\``;
}

/**
 * The edit that puts a chart above its table: the lines it replaces, or the
 * line it goes in front of, and the text. A blank line separates the chart
 * from the table and from whatever stands above it, so both still render.
 *
 * The note is read again for it: the dialog stays open as long as the person
 * likes, and a sync or another pane can change the note under it. A chart of
 * a table that is no longer where it was, line for line, could go in the
 * wrong place or show numbers the table no longer has — null, for the
 * command to say so.
 */
export function placeChart(
  lines: readonly string[],
  offer: Extract<ChartOffer, { ok: true }>,
  suggestion: ChartSuggestion
): { from: number; to: number | null; text: string } | null {
  const { from, to } = offer.table;
  const found = tableAt(lines, from, from);
  const same = offer.tableText.every((line, at) => lines[from + at] === line);
  if (!same || found?.from !== from || found.to !== to) return null;
  const block = chartBlock(suggestion);
  const replaces = chartAbove(lines, from);
  if (replaces) return { from: replaces.from, to: replaces.to, text: block };
  const above = from > 0 ? lines[from - 1] : undefined;
  const before = above !== undefined && above.trim() !== "" ? "\n" : "";
  return { from, to: null, text: `${before}${block}\n\n` };
}
