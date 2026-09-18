/**
 * Today's date, written the way the property it goes into can use it.
 *
 * A property typed as a date only accepts `YYYY-MM-DD`; anything else turns
 * the field red and drops out of every date query. A text property takes
 * whatever format the person chose. A list gains the date as one more entry
 * rather than losing what it held.
 */

/** Obsidian's property types, plus "unknown" for a key it has not typed. */
export type PropertyKind =
  | "text"
  | "multitext"
  | "aliases"
  | "tags"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "unknown";

const KINDS: ReadonlySet<string> = new Set<PropertyKind>([
  "text",
  "multitext",
  "aliases",
  "tags",
  "number",
  "checkbox",
  "date",
  "datetime"
]);

/** Today, formatted three ways by the caller, which owns the clock and the locale. */
export interface TodayStrings {
  /** `YYYY-MM-DD`, for date properties and date inputs. */
  isoDate: string;
  /** `YYYY-MM-DDTHH:mm`, for date-and-time properties. */
  isoDateTime: string;
  /** In the format from the settings, for text. */
  text: string;
}

export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
export const MAX_DATE_FORMAT_LENGTH = 40;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A type name as Obsidian reports it, which may be anything a later version invents. */
export function propertyKindOf(value: unknown): PropertyKind {
  return typeof value === "string" && KINDS.has(value) ? (value as PropertyKind) : "unknown";
}

/**
 * The value "enter today" writes into a property, or undefined where a date
 * makes no sense (a number, a checkbox, a tag), in which case it is not offered.
 */
export function todayValue(kind: PropertyKind, current: unknown, today: TodayStrings): unknown {
  switch (kind) {
    case "date":
      return today.isoDate;
    case "datetime":
      return today.isoDateTime;
    case "number":
    case "checkbox":
    case "tags":
      return undefined;
    case "multitext":
    case "aliases":
      return appended(current, today.text);
    case "text":
      return textValue(current, today);
    case "unknown":
      // An untyped key is judged by what it holds: a list stays a list.
      return Array.isArray(current) ? appended(current, today.text) : textValue(current, today);
  }
}

/** A text field that already holds an ISO date is being used as a date. */
function textValue(current: unknown, today: TodayStrings): string {
  return typeof current === "string" && ISO_DATE.test(current.trim()) ? today.isoDate : today.text;
}

function appended(current: unknown, entry: string): unknown[] {
  const list = Array.isArray(current)
    ? current
    : current === null || current === undefined || current === ""
      ? []
      : [current];
  return list.includes(entry) ? list : [...list, entry];
}

/** What a date input of this HTML type accepts: `date` and `datetime-local` want ISO. */
export function todayForInput(inputType: string, today: TodayStrings): string {
  if (inputType === "date") return today.isoDate;
  if (inputType === "datetime-local") return today.isoDateTime;
  return today.text;
}

/** The format from a data file: any non-empty string within bounds, else the default. */
export function normalizeDateFormat(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DATE_FORMAT;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_DATE_FORMAT_LENGTH
    ? trimmed
    : DEFAULT_DATE_FORMAT;
}

// Longest first, so "YYYY" is never read as two "YY" and "MMMM" never as "MM".
const DATE_TOKEN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss/g;

/**
 * A date written in a format string, with the tokens people know from daily
 * notes: YYYY YY MMMM MMM MM M DD D dddd ddd HH H mm ss, and text in square
 * brackets kept as written. Names follow `locale`, so a German vault reads
 * "September" and "Freitag".
 */
export function formatDate(date: Date, format: string, locale: string): string {
  const name = (options: Intl.DateTimeFormatOptions) => date.toLocaleString(locale, options);
  const pad = (n: number) => String(n).padStart(2, "0");

  return format.replace(DATE_TOKEN, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case "YYYY":
        return String(date.getFullYear());
      case "YY":
        return pad(date.getFullYear() % 100);
      case "MMMM":
        return name({ month: "long" });
      case "MMM":
        return name({ month: "short" });
      case "MM":
        return pad(date.getMonth() + 1);
      case "M":
        return String(date.getMonth() + 1);
      case "DD":
        return pad(date.getDate());
      case "D":
        return String(date.getDate());
      case "dddd":
        return name({ weekday: "long" });
      case "ddd":
        return name({ weekday: "short" });
      case "HH":
        return pad(date.getHours());
      case "H":
        return String(date.getHours());
      case "mm":
        return pad(date.getMinutes());
      default:
        return pad(date.getSeconds());
    }
  });
}

/** Today in the three shapes a property or an input may need. */
export function todayStrings(date: Date, format: string, locale: string): TodayStrings {
  return {
    isoDate: formatDate(date, "YYYY-MM-DD", locale),
    isoDateTime: formatDate(date, "YYYY-MM-DD[T]HH:mm", locale),
    text: formatDate(date, format, locale)
  };
}
