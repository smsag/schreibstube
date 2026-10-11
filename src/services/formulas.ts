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
import { convert, rateBetween, type ExchangeRates } from "./exchange-rates";

export type FormulaOp = "sum" | "avg" | "median" | "count" | "min" | "max";

export const FORMULA_OPS: readonly FormulaOp[] = ["sum", "avg", "median", "count", "min", "max"];

export interface FormulaContext {
  format: NumberFormat;
  /** ISO code bare numbers count in and mixed currencies convert into; "" for none. */
  defaultCurrency: string;
  /** Rates to convert with, or null when converting is off or none were ever fetched. */
  rates: ExchangeRates | null;
}

/** The rate one currency was converted at: how many units of it one unit of the default currency buys. */
export interface UsedRate {
  currency: string;
  perUnit: number;
}

export type Outcome =
  | {
      kind: "value";
      value: number;
      currency: string | null;
      decimals: number;
      /** The day of the rates it was converted at, or null when nothing was converted. */
      rateDate: string | null;
      /** The rates it was converted at, in the order the currencies first appear; none when nothing was converted. */
      rates: readonly UsedRate[];
    }
  | { kind: "subtotals"; parts: { value: number; currency: string | null; decimals: number }[] }
  /** Several currencies that could not be converted, for an operation that cannot list them. */
  | { kind: "mixed" }
  /** An average, a median, a smallest or a largest of nothing. */
  | { kind: "none" };

/** What the amounts come to under one operation. */
export function compute(op: FormulaOp, amounts: readonly Amount[], ctx: FormulaContext): Outcome {
  if (op === "count") {
    return {
      kind: "value",
      value: amounts.length,
      currency: null,
      decimals: 0,
      rateDate: null,
      rates: []
    };
  }
  const fallback = ctx.defaultCurrency || null;
  if (amounts.length === 0) {
    if (op !== "sum") return { kind: "none" };
    return { kind: "value", value: 0, currency: fallback, decimals: 0, rateDate: null, rates: [] };
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
    return valueOf(op, converted.values, ctx.defaultCurrency, Math.max(decimals, 2), {
      day: ctx.rates.date,
      rates: converted.rates
    });
  }
  if (op !== "sum") return { kind: "mixed" };
  return { kind: "subtotals", parts: subtotals(amounts, fallback) };
}

function valueOf(
  op: Exclude<FormulaOp, "count">,
  values: number[],
  currency: string | null,
  decimals: number,
  conversion: { day: string; rates: readonly UsedRate[] } | null
): Outcome {
  const value = aggregate(op, values);
  // An average or a middle of two can have decimals none of the inputs had.
  const exact = Math.abs(round(value, decimals) - value) < 1e-9;
  const places = exact ? decimals : Math.max(decimals, 2);
  return {
    kind: "value",
    value,
    currency,
    decimals: places,
    rateDate: conversion?.day ?? null,
    rates: conversion?.rates ?? []
  };
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

/**
 * Every amount in the default currency, and the rates that took it there, or
 * null when a rate is missing.
 */
function convertAll(
  amounts: readonly Amount[],
  ctx: FormulaContext
): { values: number[]; rates: UsedRate[] } | null {
  const rates = ctx.rates;
  if (!rates) return null;
  const values: number[] = [];
  const used = new Map<string, UsedRate>();
  for (const amount of amounts) {
    const from = amount.currency ?? ctx.defaultCurrency;
    const value = convert(amount.value, from, ctx.defaultCurrency, rates);
    if (value === null) return null;
    values.push(value);
    if (from !== ctx.defaultCurrency && !used.has(from)) {
      const perUnit = rateBetween(from, ctx.defaultCurrency, rates);
      if (perUnit !== null) used.set(from, { currency: from, perUnit });
    }
  }
  return { values, rates: [...used.values()] };
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

/** What a converted result was converted at, to be said once beside it or in a footnote. */
export interface RateNote {
  /** The day of the rates, written the way the number format's language writes a date. */
  day: string;
  /** The currency everything was converted into; empty when only the day is known. */
  into: string;
  /** The rates, one per currency that was converted. Empty for a result that kept only its day. */
  rates: readonly UsedRate[];
}

/**
 * The outcome as its value and, for a converted one, the note on what it was
 * converted at. Null for an outcome that has no number: mixed currencies, or
 * an average of nothing. The caller says those in words.
 */
export function outcomeParts(
  outcome: Outcome,
  format: NumberFormat
): { value: string; note: RateNote | null } | null {
  switch (outcome.kind) {
    case "value": {
      const value = formatAmount(outcome.value, outcome.currency, outcome.decimals, format);
      const note =
        outcome.rateDate === null
          ? null
          : {
              day: formatRateDate(outcome.rateDate, format),
              into: outcome.currency ?? "",
              rates: outcome.rates
            };
      return { value, note };
    }
    case "subtotals":
      return {
        value: outcome.parts
          .map((part) => formatAmount(part.value, part.currency, part.decimals, format))
          .join(" + "),
        note: null
      };
    default:
      return null;
  }
}

/**
 * The outcome as text, or null for an outcome that has no number: mixed
 * currencies, or an average of nothing. The caller says those in words.
 *
 * A converted value carries the day of its rates, because tomorrow the same
 * amounts come to something else: `≈ 342,17 € · ECB 26.09.2026`. That is the
 * form a result is stored in and compared by; what is shown or sent says the
 * rates in a note beside it instead.
 */
export function outcomeText(outcome: Outcome, format: NumberFormat): string | null {
  const parts = outcomeParts(outcome, format);
  if (!parts) return null;
  return parts.note === null ? parts.value : `≈ ${parts.value} · ECB ${parts.note.day}`;
}

/**
 * A frozen result's stored text as its value and the day it was converted at.
 * A stored result carries the day and not the rates: the number is what had to
 * stay, and the note can say no more than the text did.
 */
export function splitStoredResult(text: string): { value: string; note: RateNote | null } {
  const match = STORED_CONVERSION.exec(text.trim());
  if (!match) return { value: text.trim(), note: null };
  return { value: match[1] ?? "", note: { day: match[2] ?? "", into: "", rates: [] } };
}

const STORED_CONVERSION = /^≈\s*(.*?)\s*·\s*ECB\s+(\S+)$/u;

/** How many decimals a rate needs to be read back: two, up to the four the bank gives. */
function rateDecimals(rate: number): number {
  const rounded = Math.round(rate * 10_000) / 10_000;
  for (let places = 2; places < 4; places++) {
    if (Math.abs(round(rounded, places) - rounded) < 1e-9) return places;
  }
  return 4;
}

/** Each rate as it is read: `1 € = 1,25 $`. */
export function rateLines(note: RateNote, format: NumberFormat): string[] {
  const one = formatAmount(1, note.into, 0, format);
  return note.rates.map(
    (rate) =>
      `${one} = ${formatAmount(rate.perUnit, rate.currency, rateDecimals(rate.perUnit), format)}`
  );
}

/**
 * One note for each day: the notes of several results converted at the same
 * rates are one note, with every rate any of them used. In the order the days
 * first appear.
 */
export function mergeRateNotes(notes: readonly RateNote[]): RateNote[] {
  const byDay = new Map<string, { into: string; rates: Map<string, UsedRate> }>();
  for (const note of notes) {
    const merged = byDay.get(note.day) ?? { into: "", rates: new Map<string, UsedRate>() };
    if (merged.into === "") merged.into = note.into;
    for (const rate of note.rates) {
      if (!merged.rates.has(rate.currency)) merged.rates.set(rate.currency, rate);
    }
    byDay.set(note.day, merged);
  }
  return [...byDay].map(([day, { into, rates }]) => ({ day, into, rates: [...rates.values()] }));
}
