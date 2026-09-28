/**
 * Amounts in running text: `300 €`, `€ 20`, `1.234,50 €`, `20,-`, `-20 €`.
 *
 * Everything that adds up a note reads its numbers here — the total of a
 * selection and the formulas in a table — so a number means the same in both.
 *
 * The one thing that cannot be read off a number is whether `1.234` is a
 * thousand or a little more than one. The number format decides that case and
 * only that case: a number whose separators say it on their own (`1.234,50`,
 * `20.50`, `0,125`) is read the same whatever the setting.
 *
 * A number in quotes is meant as text — `"300 €"` in a list of prices is a
 * quotation, not a price — and is passed over on purpose.
 */

/** The number formats a person can choose; `auto` follows Obsidian's language. */
export type NumberStyle = "auto" | "comma" | "point" | "space" | "apostrophe";

export const NUMBER_STYLES: readonly NumberStyle[] = [
  "auto",
  "comma",
  "point",
  "space",
  "apostrophe"
];

/** The locale each fixed style is written in, so Intl lays the result out. */
const STYLE_LOCALES: Record<Exclude<NumberStyle, "auto">, string> = {
  comma: "de-DE",
  point: "en-US",
  space: "fr-FR",
  apostrophe: "de-CH"
};

export function normalizeNumberStyle(value: unknown): NumberStyle {
  return NUMBER_STYLES.includes(value as NumberStyle) ? (value as NumberStyle) : "auto";
}

/**
 * How numbers are read and written for one number format.
 *
 * `locale` lays results out; `decimal` is the mark that ends the whole part
 * of an ambiguous number; `spaceGroups` says whether a plain space may group
 * digits, which only a format that groups with spaces can afford — elsewhere
 * `300 200` is two numbers.
 */
export interface NumberFormat {
  locale: string;
  decimal: "." | ",";
  spaceGroups: boolean;
}

/**
 * The format for a style, with `obsidianLanguage` standing in for `auto`.
 *
 * Automatic asks Intl how Obsidian's language writes a number, rather than
 * keeping a table of languages: every language Obsidian offers is covered,
 * and one this plugin has never heard of is too.
 */
export function numberFormatFor(style: NumberStyle, obsidianLanguage: string): NumberFormat {
  const locale = style === "auto" ? latinLocale(obsidianLanguage) : STYLE_LOCALES[style];
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  const decimal = parts.find((part) => part.type === "decimal")?.value === "," ? "," : ".";
  const group = parts.find((part) => part.type === "group")?.value ?? ",";
  return { locale, decimal, spaceGroups: /\s/.test(group) };
}

/** The locale, or English when Intl does not know it, always with Latin digits. */
function latinLocale(language: string): string {
  const tag = language.trim() || "en";
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? "en";
  } catch {
    return "en";
  }
}

/** One amount read from text. */
export interface Amount {
  value: number;
  /** ISO code, or null for a bare number. */
  currency: string | null;
  /** Digits after the decimal mark as written, so a total keeps the cents. */
  decimals: number;
}

/**
 * The currencies an amount can carry: the ones the European Central Bank
 * publishes a rate for, and the euro. A three-letter word outside this list is
 * a word — `THE`, `PDF` — and not a currency.
 */
export const CURRENCY_CODES: readonly string[] = [
  "EUR",
  "USD",
  "JPY",
  "BGN",
  "CZK",
  "DKK",
  "GBP",
  "HUF",
  "PLN",
  "RON",
  "SEK",
  "CHF",
  "ISK",
  "NOK",
  "TRY",
  "AUD",
  "BRL",
  "CAD",
  "CNY",
  "HKD",
  "IDR",
  "ILS",
  "INR",
  "KRW",
  "MXN",
  "MYR",
  "NZD",
  "PHP",
  "SGD",
  "THB",
  "ZAR"
];

/** Signs that name one currency. `kr` and `Fr.` are left out: each names several. */
const CURRENCY_SIGNS: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₩": "KRW",
  "₺": "TRY",
  "₪": "ILS",
  R$: "BRL",
  zł: "PLN",
  Kč: "CZK"
};

export function normalizeCurrency(value: unknown): string {
  if (typeof value !== "string") return "";
  const code = value.trim().toUpperCase();
  return CURRENCY_CODES.includes(code) ? code : "";
}

/** Longest first, so `R$` is not read as a dollar. */
const CURRENCY_PATTERN = [...Object.keys(CURRENCY_SIGNS), ...CURRENCY_CODES]
  .sort((a, b) => b.length - a.length)
  .map((sign) => sign.replace(/[$]/g, "\\$"))
  .join("|");

/**
 * A number with the currency on either side.
 *
 * Group separators are three-digit runs after a dot, comma, apostrophe or a
 * space that cannot break a line; a plain space is tried separately, only for
 * a format that groups with it. The lookarounds keep a number glued to a word
 * (`A4`), a time (`12:30`), a path or a percentage out.
 */
function amountPattern(spaceGroups: boolean): RegExp {
  const group = spaceGroups ? "[.,'’\\u00a0\\u202f ]" : "[.,'’\\u00a0\\u202f]";
  const number = `\\d{1,3}(?:${group}\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?`;
  return new RegExp(
    `(?<![\\p{L}\\p{N}:/_.,\\-−])` +
      `(?<pre>${CURRENCY_PATTERN})?\\s?` +
      `(?<sign>[-−+])?` +
      `(?<pre2>${CURRENCY_PATTERN})?\\s?` +
      `(?<number>${number})(?<dash>[.,]-)?` +
      `(?:\\s?(?<post>${CURRENCY_PATTERN}))?` +
      `(?![\\p{L}\\p{N}:/_%])(?!\\s[%‰])(?![.,]\\d)`,
    "gu"
  );
}

const PATTERNS = new Map<boolean, RegExp>();
function patternFor(format: NumberFormat): RegExp {
  let pattern = PATTERNS.get(format.spaceGroups);
  if (!pattern) {
    pattern = amountPattern(format.spaceGroups);
    PATTERNS.set(format.spaceGroups, pattern);
  }
  pattern.lastIndex = 0;
  return pattern;
}

/**
 * The value of a number as written, and how many decimals it was written
 * with; null when its separators contradict each other (`26.09.2026`).
 */
export function readNumber(
  written: string,
  format: NumberFormat
): { value: number; decimals: number } | null {
  const marks = [...written.matchAll(/[^\d]/g)].map((match) => ({
    mark: match[0],
    at: match.index
  }));
  if (marks.length === 0) return { value: Number(written), decimals: 0 };

  const decimalAt = decimalPosition(written, marks, format);
  const whole = decimalAt === -1 ? written : written.slice(0, decimalAt);
  const fraction = decimalAt === -1 ? "" : written.slice(decimalAt + 1);
  if (decimalAt !== -1 && !/^\d+$/.test(fraction)) return null;

  // Every separator left is a group separator: one kind of them, and three
  // digits after each.
  const groups = whole.split(/[^\d]/);
  const separators = new Set(whole.replace(/\d/g, ""));
  if (separators.size > 1) return null;
  if (groups.length > 1) {
    const [first, ...rest] = groups;
    if (!first || first.length > 3 || rest.some((run) => run.length !== 3)) return null;
  }
  const value = Number(`${groups.join("")}${fraction ? `.${fraction}` : ""}`);
  return { value, decimals: fraction.length };
}

/** Where the decimal mark is, or -1 for a whole number. */
function decimalPosition(
  written: string,
  marks: { mark: string; at: number }[],
  format: NumberFormat
): number {
  const points = marks.filter((m) => m.mark === "." || m.mark === ",");
  if (points.length === 0) return -1;
  const last = points[points.length - 1]!;
  const kinds = new Set(points.map((m) => m.mark));
  // Both kinds: the last one ends the whole part, whatever the format says.
  if (kinds.size === 2) return last.at;
  // One kind, more than once: it groups.
  if (points.length > 1) return -1;
  // Once, and anything but three digits after it: it can only be a decimal mark.
  const after = written.length - last.at - 1;
  if (after !== 3) return last.at;
  // `0,125`: nothing groups a zero.
  if (/^[0]$/.test(written.slice(0, last.at))) return last.at;
  // Grouped by a space or an apostrophe already: the point is the decimal.
  if (marks.length > 1) return last.at;
  // `1.234`: the one case the number cannot settle. The format does.
  return last.mark === format.decimal ? last.at : -1;
}

/** Stretches of the text inside quotation marks, as [from, to). */
function quotedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const pattern = /"[^"\n]*"|“[^”\n]*”|„[^“”"\n]*[“”"]|«[^»\n]*»|»[^«\n]*«/g;
  for (const match of text.matchAll(pattern)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** A formula in a table cell, which the text around a total must not count again. */
export const FORMULA_TEXT = /=(?:sum|avg|median|count|min|max)(?:\([^)\n]*\))?/giu;

interface Found {
  amount: Amount;
  quoted: boolean;
}

/** Every amount in a piece of text, in order, with whether it stands in quotes. */
function findAmounts(text: string, format: NumberFormat): Found[] {
  const plain = text.replace(FORMULA_TEXT, (formula) => " ".repeat(formula.length));
  const quoted = quotedRanges(plain);
  const found: Found[] = [];
  for (const match of plain.matchAll(patternFor(format))) {
    const groups = match.groups ?? {};
    const number = readNumber(groups.number ?? "", format);
    if (number === null) continue;
    const negative = groups.sign === "-" || groups.sign === "−";
    const sign = groups.pre ?? groups.pre2 ?? groups.post;
    const currency = sign ? (CURRENCY_SIGNS[sign] ?? sign) : null;
    found.push({
      amount: {
        value: negative ? -number.value : number.value,
        currency,
        decimals: number.decimals
      },
      quoted: quoted.some(([from, to]) => match.index >= from && match.index < to)
    });
  }
  return found;
}

/**
 * The amount a line stands for, when it has one.
 *
 * `2 × Milch 1,50 €` costs 1,50 €, not 3,50: of several numbers, the one with
 * a currency is the amount, and of several of those the last — prices are
 * written after what they price.
 */
function pick(found: Found[]): Amount | null {
  const counted = found.filter((entry) => !entry.quoted).map((entry) => entry.amount);
  const priced = counted.filter((amount) => amount.currency !== null);
  return priced[priced.length - 1] ?? counted[counted.length - 1] ?? null;
}

/** What a table cell holds, as far as a formula is concerned. */
export type CellReading =
  | { kind: "amount"; amount: Amount }
  /** Nothing in it, or nothing but punctuation: not counted, not reported. */
  | { kind: "empty" }
  /** An amount in quotes: left out on purpose, so not reported either. */
  | { kind: "quoted" }
  /** Text without an amount — a typo, a dash: left out and reported. */
  | { kind: "unreadable" };

export function readCell(text: string, format: NumberFormat): CellReading {
  if (!/[\p{L}\p{N}]/u.test(text.replace(FORMULA_TEXT, ""))) return { kind: "empty" };
  const found = findAmounts(text, format);
  const amount = pick(found);
  if (amount) return { kind: "amount", amount };
  return found.length > 0 ? { kind: "quoted" } : { kind: "unreadable" };
}

/** One amount per line that has one, for the total of a selection. */
export function amountsInText(text: string, format: NumberFormat): Amount[] {
  const amounts: Amount[] = [];
  for (const line of text.split("\n")) {
    const amount = pick(findAmounts(line, format));
    if (amount) amounts.push(amount);
  }
  return amounts;
}
