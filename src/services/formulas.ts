/**
 * What a list of amounts comes to, and how that is written.
 *
 * Six operations, one rule for currencies. Amounts in one currency are simply
 * added; a bare number joins it. Amounts in several currencies are converted
 * into the default currency when there is one and rates to convert with, and
 * the result says which day's rates. Without that, a sum is given per
 * currency — `300 € + 20 $` — and the other operations say the currencies are
 * mixed: an average of euros and dollars is not a number anyone can use.
 */
import type { Amount, NumberFormat } from "./amounts";
import { convert, type ExchangeRates } from "./exchange-rates";

export type FormulaOp = "sum" | "avg" | "median" | "count" | "min" | "max";

export const FORMULA_OPS: readonly FormulaOp[] = ["sum", "avg", "median", "count", "min", "max"];

export interface FormulaContext {
  format: NumberFormat;
  /** ISO code bare numbers count in and mixed currencies convert into; "" for none. */
  defaultCurrency: string;
  /** Rates to convert with, or null when converting is off or none were ever fetched. */
  rates: ExchangeRates | null;
}

export type Outcome =
  | {
      kind: "value";
      value: number;
      currency: string | null;
      decimals: number;
      /** The day of the rates it was converted at, or null when nothing was converted. */
      rateDate: string | null;
    }
  | { kind: "subtotals"; parts: { value: number; currency: string | null; decimals: number }[] }
  /** Several currencies that could not be converted, for an operation that cannot list them. */
  | { kind: "mixed" }
  /** An average, a median, a smallest or a largest of nothing. */
  | { kind: "none" };

/** What the amounts come to under one operation. */
export function compute(op: FormulaOp, amounts: readonly Amount[], ctx: FormulaContext): Outcome {
  if (op === "count") {
    return { kind: "value", value: amounts.length, currency: null, decimals: 0, rateDate: null };
  }
  const fallback = ctx.defaultCurrency || null;
  if (amounts.length === 0) {
    if (op !== "sum") return { kind: "none" };
    return { kind: "value", value: 0, currency: fallback, decimals: 0, rateDate: null };
  }

  const currencies = [...new Set(amounts.map((a) => a.currency).filter((c) => c !== null))];
  const decimals = amounts.reduce((most, a) => Math.max(most, a.decimals), 0);

  if (currencies.length <= 1) {
    const currency = currencies[0] ?? fallback;
    return valueOf(
      op,
      amounts.map((a) => a.value),
      currency,
      decimals,
      null
    );
  }

  const converted = ctx.defaultCurrency && ctx.rates ? convertAll(amounts, ctx) : null;
  if (converted && ctx.rates) {
    // Converted money is written to the cent, whatever the inputs were.
    return valueOf(op, converted, ctx.defaultCurrency, Math.max(decimals, 2), ctx.rates.date);
  }
  if (op !== "sum") return { kind: "mixed" };
  return { kind: "subtotals", parts: subtotals(amounts, fallback) };
}

function valueOf(
  op: Exclude<FormulaOp, "count">,
  values: number[],
  currency: string | null,
  decimals: number,
  rateDate: string | null
): Outcome {
  const value = aggregate(op, values);
  // An average or a middle of two can have decimals none of the inputs had.
  const exact = Math.abs(round(value, decimals) - value) < 1e-9;
  const places = exact ? decimals : Math.max(decimals, 2);
  return { kind: "value", value, currency, decimals: places, rateDate };
}

function aggregate(op: Exclude<FormulaOp, "count">, values: number[]): number {
  switch (op) {
    case "sum":
      return values.reduce((total, value) => total + value, 0);
    case "avg":
      return values.reduce((total, value) => total + value, 0) / values.length;
    // Not spread into `Math.min`: a column of a hundred thousand rows is
    // more arguments than a call may take, and the formula threw instead.
    case "min":
      return values.reduce((least, value) => Math.min(least, value), Infinity);
    case "max":
      return values.reduce((most, value) => Math.max(most, value), -Infinity);
    case "median": {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2;
    }
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Every amount in the default currency, or null when a rate is missing. */
function convertAll(amounts: readonly Amount[], ctx: FormulaContext): number[] | null {
  const values: number[] = [];
  for (const amount of amounts) {
    const from = amount.currency ?? ctx.defaultCurrency;
    const value = ctx.rates ? convert(amount.value, from, ctx.defaultCurrency, ctx.rates) : null;
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

/** One sum per currency, in the order the currencies first appear. */
function subtotals(
  amounts: readonly Amount[],
  fallback: string | null
): { value: number; currency: string | null; decimals: number }[] {
  const parts = new Map<
    string | null,
    { value: number; currency: string | null; decimals: number }
  >();
  for (const amount of amounts) {
    const currency = amount.currency ?? fallback;
    const part = parts.get(currency) ?? { value: 0, currency, decimals: 0 };
    part.value += amount.value;
    part.decimals = Math.max(part.decimals, amount.decimals);
    parts.set(currency, part);
  }
  return [...parts.values()];
}

/** An amount written the way the number format writes one. */
export function formatAmount(
  value: number,
  currency: string | null,
  decimals: number,
  format: NumberFormat
): string {
  const places = Math.min(Math.max(decimals, 0), 6);
  return new Intl.NumberFormat(format.locale, {
    numberingSystem: "latn",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    ...(currency ? { style: "currency", currency, currencyDisplay: "narrowSymbol" } : {})
  }).format(value);
}

/** The day of a rate, written the way the number format's language writes a date. */
export function formatRateDate(date: string, format: NumberFormat): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(format.locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
    numberingSystem: "latn"
  }).format(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

/**
 * The outcome as text, or null for an outcome that has no number: mixed
 * currencies, or an average of nothing. The caller says those in words.
 *
 * A converted value carries the day of its rates, because tomorrow the same
 * amounts come to something else: `≈ 342,17 € · ECB 26.09.2026`.
 */
export function outcomeText(outcome: Outcome, format: NumberFormat): string | null {
  switch (outcome.kind) {
    case "value": {
      const text = formatAmount(outcome.value, outcome.currency, outcome.decimals, format);
      return outcome.rateDate === null
        ? text
        : `≈ ${text} · ECB ${formatRateDate(outcome.rateDate, format)}`;
    }
    case "subtotals":
      return outcome.parts
        .map((part) => formatAmount(part.value, part.currency, part.decimals, format))
        .join(" + ");
    default:
      return null;
  }
}
