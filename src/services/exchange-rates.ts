/**
 * The European Central Bank's daily reference rates, read, kept and checked.
 *
 * The bank publishes one small XML file each working day, free and without a
 * key: how many of each currency one euro buys. That is all a total in mixed
 * currencies needs, so nothing else is fetched and nothing else is kept.
 *
 * The file comes from outside the process and the kept copy from `data.json`,
 * which a person can edit; both are checked here before anything is converted
 * with them.
 */
import { t } from "../i18n";
import { CURRENCY_CODES } from "./amounts";
import { exceedsBytes } from "./response-size";

export const RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** The daily file is about 1.5 KB; anything near this is not that file. */
export const MAX_RATES_BYTES = 64 * 1024;

export const RATES_TIMEOUT_MS = 15_000;

/**
 * Why the bank's answer is refused for its size, or null when it is not.
 *
 * The parser holds the same bound, but only once the body has been decoded
 * into text; this reads the bytes and the declared length, before that.
 */
export function ratesSizeProblem(
  headers: Record<string, string> | undefined,
  body: ArrayBuffer | string
): string | null {
  return exceedsBytes(headers, body, MAX_RATES_BYTES) ? t().sums.ratesTooLarge : null;
}

/**
 * How long fetched rates are used before they are fetched again.
 *
 * The bank publishes once a working day, in the afternoon; half a day keeps
 * a total at most one publication behind and costs two requests a day at
 * most, and none on a day nothing is converted.
 */
export const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * How long a failed fetch is not tried again. A total on screen asks on every
 * redraw, and a bank that is down, or a phone offline, would otherwise be
 * asked on every keystroke of a selection.
 */
export const RATES_RETRY_MS = 10 * 60 * 1000;

export interface ExchangeRates {
  /** The day the bank published them, `YYYY-MM-DD`. */
  date: string;
  /** When this device fetched them, epoch ms. */
  fetchedAt: number;
  /** Units of each currency one euro buys. The euro itself is not listed. */
  rates: Record<string, number>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The rates in the bank's file, or null when it is not that file.
 *
 * Read with patterns rather than an XML parser: the file is a flat list of
 * `<Cube currency='USD' rate='1.0712'/>`, and a parser would be the largest
 * thing about this feature.
 */
export function parseEcbRates(xml: string, fetchedAt: number): ExchangeRates | null {
  if (xml.length > MAX_RATES_BYTES) return null;
  const date = /<Cube\s+time=['"]([^'"]+)['"]/.exec(xml)?.[1];
  if (!date || !DATE.test(date)) return null;

  const rates: Record<string, number> = {};
  for (const match of xml.matchAll(
    /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([^'"]+)['"]/g
  )) {
    const [, code, written] = match;
    const rate = Number(written);
    if (code && CURRENCY_CODES.includes(code) && Number.isFinite(rate) && rate > 0) {
      rates[code] = rate;
    }
  }
  return Object.keys(rates).length > 0 ? { date, fetchedAt, rates } : null;
}

/** The kept rates from `data.json`, or null when they are not rates. */
export function normalizeExchangeRates(value: unknown): ExchangeRates | null {
  if (!value || typeof value !== "object") return null;
  const { date, fetchedAt, rates } = value as Partial<ExchangeRates>;
  if (typeof date !== "string" || !DATE.test(date)) return null;
  if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) return null;
  if (!rates || typeof rates !== "object") return null;

  const kept: Record<string, number> = {};
  for (const [code, rate] of Object.entries(rates)) {
    if (
      CURRENCY_CODES.includes(code) &&
      typeof rate === "number" &&
      Number.isFinite(rate) &&
      rate > 0
    ) {
      kept[code] = rate;
    }
  }
  return Object.keys(kept).length > 0 ? { date, fetchedAt, rates: kept } : null;
}

/** Whether the kept rates are too old to be used without asking again. */
export function ratesStale(rates: ExchangeRates | null, now: number): boolean {
  return rates === null || now - rates.fetchedAt > RATES_MAX_AGE_MS || now < rates.fetchedAt;
}

/** An amount in one currency in another, or null when a rate is missing. */
export function convert(
  value: number,
  from: string,
  to: string,
  rates: ExchangeRates
): number | null {
  if (from === to) return value;
  const perEuroFrom = from === "EUR" ? 1 : rates.rates[from];
  const perEuroTo = to === "EUR" ? 1 : rates.rates[to];
  if (perEuroFrom === undefined || perEuroTo === undefined) return null;
  return (value / perEuroFrom) * perEuroTo;
}
