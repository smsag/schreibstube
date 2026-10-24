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
 * status bar charts with the same numbers.
 */
import { CURRENCY_CODES, FORMULA_TEXT, readCell, type NumberFormat } from "./amounts";
import { isTableDelimiter, rowCells } from "./markdown-table";

/** The first line of every chart this makes, so making it again finds it. */
export const CHART_MARKER = "%% schreibstube chart";

/** Past this, a table is a dataset rather than a note's table, and is not read. */
export const MAX_CHART_ROWS = 5_000;
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
  | { ok: true; table: TableLines; suggestions: ChartSuggestion[]; replaces: TableLines | null }
  | { ok: false; reason: ChartRefusal };

/**
 * The table a selection is in: the first selected line that is a table row,
 * widened to the whole table. A table needs its header, the delimiter under
 * it and at least one row.
 */
export function tableAt(lines: readonly string[], first: number, last: number): TableLines | null {
  for (let line = Math.max(0, first); line <= Math.min(last, lines.length - 1); line++) {
    if (!isRow(lines[line])) continue;
    let from = line;
    while (from > 0 && isRow(lines[from - 1])) from--;
    let to = line;
    while (to + 1 < lines.length && isRow(lines[to + 1])) to++;
    const delimiter = lines[from + 1];
    if (delimiter === undefined || !isTableDelimiter(delimiter) || to < from + 2) return null;
    return { from, to };
  }
  return null;
}

function isRow(line: string | undefined): boolean {
  return line !== undefined && line.includes("|") && line.trim() !== "";
}

/**
 * The table's cells as plain text, every row as wide as the header. A row
 * with a formula is the table's total, and charting it would count the table
 * twice; an empty row says nothing.
 */
export function readTable(lines: readonly string[], at: TableLines): PlainTable {
  const header = rowCells(lines[at.from] ?? "").map(plainText);
  const rows: string[][] = [];
  for (let line = at.from + 2; line <= at.to; line++) {
    const cells = rowCells(lines[line] ?? "");
    if (cells.some((cell) => cell.search(FORMULA_TEXT) !== -1)) continue;
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
  | { kind: "date"; index: number; name: string; yearsOnly: boolean }
  | { kind: "text"; index: number; name: string; groups: number; average: number }
  | { kind: "empty"; index: number; name: string };

/**
 * A date as a table writes one: `2026-03-15`, `15.03.2026`, `15.03.26`,
 * `2026-03` for a month, and `03/15/2026` or `15/03/2026` — which of the two
 * the slashes mean is settled by a part above twelve, and otherwise by the
 * number format: a comma for decimals writes the day first.
 */
export function readDate(text: string, dayFirst: boolean): Day | null {
  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ].*)?$/.exec(text);
  if (iso) return day(Number(iso[1]), Number(iso[2]), iso[3] ? Number(iso[3]) : 1);
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(text);
  if (dotted) return day(fullYear(dotted[3]!), Number(dotted[2]), Number(dotted[1]));
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (slashed) {
    const a = Number(slashed[1]);
    const b = Number(slashed[2]);
    const first = a > 12 ? true : b > 12 ? false : dayFirst;
    return first ? day(fullYear(slashed[3]!), b, a) : day(fullYear(slashed[3]!), a, b);
  }
  return null;
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
 * read as amounts would chart the shop numbers.
 */
export function isFigure(cell: string): boolean {
  const rest = cell
    .replace(CURRENCY_WORDS, "")
    .replace(/R\$|\p{Sc}|zł|Kč/gu, "")
    .replace(/[\d\s.,'’+\-−()]/g, "");
  return /\d/.test(cell) && rest === "";
}

const CURRENCY_WORDS = new RegExp(`\\b(?:${CURRENCY_CODES.join("|")})\\b`, "g");

/** A column of whole numbers between these, with no currency, counts years. */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2100;

function profile(table: PlainTable, format: NumberFormat): Column[] {
  const dayFirst = format.decimal === ",";
  return table.header.map((name, index) => {
    const cells = table.rows.map((row) => row[index] ?? "").filter((cell) => cell !== "");
    if (cells.length === 0) return { kind: "empty", index, name };
    const dates = cells.filter((cell) => readDate(cell, dayFirst) !== null).length;
    if (dates >= cells.length * DATE_SHARE) return { kind: "date", index, name, yearsOnly: false };

    const amounts = cells.flatMap((cell) => {
      const reading = isFigure(cell) ? readCell(cell, format) : null;
      return reading?.kind === "amount" ? [reading.amount] : [];
    });
    if (amounts.length >= cells.length * AMOUNT_SHARE) {
      const years = amounts.every(
        (amount) =>
          amount.currency === null &&
          amount.decimals === 0 &&
          amount.value >= FIRST_YEAR &&
          amount.value <= LAST_YEAR
      );
      if (years && amounts.length === cells.length) {
        return { kind: "date", index, name, yearsOnly: true };
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
    }
    const average = cells.reduce((sum, cell) => sum + cell.length, 0) / cells.length;
    return { kind: "text", index, name, groups: new Set(cells).size, average };
  });
}

/** A column named like what is spent, earned or counted. */
const AMOUNT_WORDS =
  /betrag|summe|preis|kosten|ausgabe|einnahme|umsatz|wert|amount|sum|price|cost|expense|spend|income|revenue|value|total/i;
/** A running balance adds up to nothing meaningful. */
const BALANCE_WORDS = /saldo|kontostand|bestand|balance/i;
/** A column named like the groups a table falls into. */
const GROUP_WORDS = /kategorie|art|typ|gruppe|bereich|category|kind|type|group|class/i;

function valueColumn(columns: Column[]): Extract<Column, { kind: "amount" }> | "mixed" | null {
  const amounts = columns.filter(
    (column): column is Extract<Column, { kind: "amount" }> =>
      column.kind === "amount" && !BALANCE_WORDS.test(column.name)
  );
  if (amounts.length === 0) return null;
  const usable = amounts.filter((column) => !column.mixed);
  if (usable.length === 0) return "mixed";
  const score = (column: Extract<Column, { kind: "amount" }>): number =>
    (AMOUNT_WORDS.test(column.name) ? 2 : 0) + (column.currency ? 1 : 0);
  return usable.reduce((best, column) => (score(column) > score(best) ? column : best));
}

/** The text columns worth grouping by, the likeliest first. */
function groupColumns(columns: Column[]): Extract<Column, { kind: "text" }>[] {
  const texts = columns.filter(
    (column): column is Extract<Column, { kind: "text" }> =>
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
  const value = valueColumn(columns);
  if (value === "mixed") return { ok: false, reason: "mixed-currencies" };
  if (!value) return { ok: false, reason: "no-amounts" };

  const read = table.rows.flatMap((row): Entry[] => {
    const reading = readCell(row[value.index] ?? "", format);
    return reading.kind === "amount" ? [{ value: reading.amount.value, row }] : [];
  });
  if (read.length === 0 || read.every((entry) => entry.value === 0)) {
    return { ok: false, reason: "no-amounts" };
  }
  // A statement writes what went out as negative. Drawn as it stands, every
  // bar would hang below the axis and no pie could be cut at all.
  const spending = read.every((entry) => entry.value <= 0);
  const entries = spending ? read.map((entry) => ({ ...entry, value: -entry.value })) : read;
  const valueName = value.currency ? `${value.name} (${value.currency})` : value.name;

  const suggestions: ChartSuggestion[] = [];
  const date = columns.find(
    (column): column is Extract<Column, { kind: "date" }> => column.kind === "date"
  );
  if (date) {
    const time = timeChart(entries, date, value.name, valueName, format, labels);
    if (time) suggestions.push(time);
  }
  const groups = groupColumns(columns);
  const [outer, inner] = groups;
  if (outer) suggestions.push(groupChart(entries, outer, value.name, valueName, labels));
  if (!date && outer && inner && entries.every((entry) => entry.value > 0)) {
    // The column with fewer values is the outer one, whatever their order.
    const [big, small] = outer.groups <= inner.groups ? [outer, inner] : [inner, outer];
    suggestions.push(treemapChart(entries, big, small, value.name, labels));
  }
  if (suggestions.length === 0) return { ok: false, reason: "no-groups" };
  return { ok: true, suggestions: suggestions.slice(0, 2) };
}

function timeChart(
  entries: Entry[],
  column: Extract<Column, { kind: "date" }>,
  name: string,
  axisName: string,
  format: NumberFormat,
  labels: ChartLabels
): ChartSuggestion | null {
  const dayFirst = format.decimal === ",";
  const dated = entries.flatMap((entry) => {
    const cell = entry.row[column.index] ?? "";
    const when = column.yearsOnly
      ? { year: Number(cell), month: 1, day: 1 }
      : readDate(cell, dayFirst);
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

  const dayLabel = new Intl.DateTimeFormat(format.locale, {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC"
  });
  const monthLabel = new Intl.DateTimeFormat(format.locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC"
  });
  const label = (key: number): string =>
    period === "day"
      ? dayLabel.format(new Date(key * 86_400_000))
      : period === "month"
        ? monthLabel.format(new Date(Date.UTC(Math.floor(key / 12), key % 12, 1)))
        : String(key);

  const title =
    period === "day"
      ? labels.perDay(name)
      : period === "month"
        ? labels.perMonth(name)
        : labels.perYear(name);
  return {
    kind: "time",
    title,
    source: [
      CHART_MARKER,
      "xychart-beta",
      `    title ${quote(title)}`,
      `    x-axis [${keys.map((key) => quote(label(key))).join(", ")}]`,
      `    y-axis ${quote(axisName)} ${axisRange(keys.map((key) => sums.get(key) ?? 0))}`,
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

function groupChart(
  entries: Entry[],
  column: Extract<Column, { kind: "text" }>,
  name: string,
  axisName: string,
  labels: ChartLabels
): ChartSuggestion {
  const title = labels.byGroup(name, column.name);
  const pie = grouped(entries, column.index, MAX_PIE_SLICES, labels.other);
  if (column.groups <= MAX_PIE_SLICES && pie.every(([, value]) => value > 0)) {
    return {
      kind: "pie",
      title,
      // A pie's title is the rest of its line; quotes would be drawn as written.
      source: [
        CHART_MARKER,
        "pie showData",
        `    title ${title.replace(/[\r\n]/g, " ")}`,
        ...pie.map(([group, value]) => `    ${quote(group)} : ${figure(value)}`)
      ].join("\n")
    };
  }
  const bars = grouped(entries, column.index, MAX_BARS, labels.other);
  return {
    kind: "bars",
    title,
    source: [
      CHART_MARKER,
      "xychart-beta horizontal",
      `    title ${quote(title)}`,
      `    x-axis [${bars.map(([group]) => quote(group)).join(", ")}]`,
      `    y-axis ${quote(axisName)} ${axisRange(bars.map(([, value]) => value))}`,
      `    bar [${bars.map(([, value]) => figure(value)).join(", ")}]`
    ].join("\n")
  };
}

function treemapChart(
  entries: Entry[],
  outer: Extract<Column, { kind: "text" }>,
  inner: Extract<Column, { kind: "text" }>,
  name: string,
  labels: ChartLabels
): ChartSuggestion {
  const title = labels.byGroups(name, outer.name, inner.name);
  const lines = [CHART_MARKER, "treemap-beta", quote(title)];
  const sorted = sumsBy(entries, outer.index);
  const named = sorted.length <= MAX_BARS ? sorted : sorted.slice(0, MAX_BARS - 1);
  const shown = new Set(named.map(([group]) => group));
  const tiles: [string, Entry[]][] = named.map(([group]) => [
    group,
    entries.filter((entry) => (entry.row[outer.index] || "–") === group)
  ]);
  const rest = entries.filter((entry) => !shown.has(entry.row[outer.index] || "–"));
  if (rest.length > 0) tiles.push([labels.other, rest]);
  for (const [group, members] of tiles) {
    lines.push(`    ${quote(group)}`);
    for (const [member, value] of grouped(members, inner.index, MAX_BARS, labels.other)) {
      lines.push(`        ${quote(member)}: ${figure(value)}`);
    }
  }
  return { kind: "treemap", title, source: lines.join("\n") };
}

/** A label as Mermaid reads one: in quotes, with none inside, and not too long to draw. */
function quote(text: string): string {
  const flat = text.replace(/"/g, "'").replace(/\s+/g, " ").trim();
  const short = flat.length > MAX_LABEL_CHARS ? `${flat.slice(0, MAX_LABEL_CHARS - 1)}…` : flat;
  return `"${short}"`;
}

/**
 * The value axis from zero, or from below it when a bar is negative, to a
 * round number past the largest. Mermaid starts the axis at the smallest bar
 * otherwise, and a bar of 1058 next to one of 1069 then looks like nothing
 * next to something.
 */
export function axisRange(values: readonly number[]): string {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const top = high > 0 ? roundUp(high) : 0;
  const bottom = low < 0 ? -roundUp(-low) : 0;
  return `${figure(bottom)} --> ${figure(top === bottom ? 1 : top)}`;
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
 * the new one replaces.
 */
export function chartOffer(
  lines: readonly string[],
  first: number,
  last: number,
  format: NumberFormat,
  labels: ChartLabels
): ChartOffer {
  const table = tableAt(lines, first, last);
  if (!table) return { ok: false, reason: "no-table" };
  if (table.to - table.from - 1 > MAX_CHART_ROWS) return { ok: false, reason: "too-long" };
  const result = suggestCharts(readTable(lines, table), format, labels);
  if (!result.ok) return result;
  return {
    ok: true,
    table,
    suggestions: result.suggestions,
    replaces: chartAbove(lines, table.from)
  };
}

/**
 * The chart this made above a table, fence to fence, when only blank lines
 * stand between it and the table. A Mermaid block someone wrote has no marker
 * and is left alone.
 */
export function chartAbove(lines: readonly string[], tableFrom: number): TableLines | null {
  let close = tableFrom - 1;
  while (close >= 0 && lines[close]!.trim() === "") close--;
  if (close < 2 || !/^(`{3,}|~{3,})\s*$/.test(lines[close]!.trim())) return null;
  for (let open = close - 1; open >= 0; open--) {
    const line = lines[open]!.trim();
    if (!/^(`{3,}|~{3,})/.test(line)) continue;
    if (!/^(`{3,}|~{3,})mermaid\s*$/.test(line)) return null;
    return lines[open + 1]?.trim() === CHART_MARKER ? { from: open, to: close } : null;
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
 */
export function placeChart(
  lines: readonly string[],
  offer: Extract<ChartOffer, { ok: true }>,
  suggestion: ChartSuggestion
): { from: number; to: number | null; text: string } {
  const block = chartBlock(suggestion);
  if (offer.replaces) return { from: offer.replaces.from, to: offer.replaces.to, text: block };
  const above = offer.table.from > 0 ? lines[offer.table.from - 1] : undefined;
  const before = above !== undefined && above.trim() !== "" ? "\n" : "";
  return { from: offer.table.from, to: null, text: `${before}${block}\n\n` };
}
