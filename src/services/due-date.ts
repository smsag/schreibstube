/**
 * The day a note is due, for a row in the file pane.
 *
 * A note says it with one frontmatter key and the Explorer shows the day
 * beside its name. Nothing reminds and nothing schedules: the date is there to
 * be seen while looking down a list, the way the task count is.
 *
 * Only the day counts. A row cannot show an hour without becoming a clock
 * nobody asked for. A value without a zone — what Obsidian's own date and
 * date-and-time properties write — is due on the day it names. A value with
 * `Z` or an offset was written by a script from an instant, so it is due on
 * the local day that instant falls on, not on the day of its UTC spelling.
 */
import { isoDate } from "./print-data";

/** Frontmatter a note carries to say when it is due. */
export const DUE_KEY = "schreibstubeDue";

/**
 * Longer than any date or date-and-time Obsidian or a script writes. A value
 * past it is not a date, and nothing below has to walk a pasted paragraph.
 */
export const MAX_DUE_LENGTH = 40;

/**
 * Below it, a year is a typo for a four-digit one (`0026` for `2026`), and
 * the platform's date arithmetic reads two-digit years as the 1900s besides.
 */
const MIN_DUE_YEAR = 1000;

const DUE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):?(\d{2}))?)?$/;

/** Where today falls against the due day. */
export type DueState = "upcoming" | "today" | "overdue";

export interface DueDate {
  /** `YYYY-MM-DD`; compares as text in calendar order. */
  iso: string;
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
}

/** The local calendar day an instant falls on, as `YYYY-MM-DD`. */
export type LocalDayOf = (epochMs: number) => string;

const localDayOf: LocalDayOf = (epochMs) => isoDate(new Date(epochMs));

/**
 * The due day a note's frontmatter names, or null when it names none. A value
 * that is not a real calendar day or time — `2026-02-30`, `T25:00`, a word, a
 * list — is null as well, so a typo shows nothing rather than a date the
 * person did not write.
 */
export function dueDateOf(frontmatter: unknown, dayOf: LocalDayOf = localDayOf): DueDate | null {
  if (!frontmatter || typeof frontmatter !== "object") return null;
  const value = (frontmatter as Record<string, unknown>)[DUE_KEY];
  if (typeof value !== "string" || value.length > MAX_DUE_LENGTH) return null;

  const match = DUE_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, hh, mi, ss, zone, sign, offH, offM] = match;
  const date = calendarDay(Number(y), Number(mo), Number(d));
  if (!date) return null;
  if (hh !== undefined && (Number(hh) > 23 || Number(mi) > 59 || Number(ss ?? 0) > 59)) {
    return null;
  }
  if (zone === undefined) return date;

  if (sign !== undefined && (Number(offH) > 14 || Number(offM) > 59)) return null;
  const offsetMinutes =
    sign === undefined ? 0 : (sign === "-" ? -1 : 1) * (Number(offH) * 60 + Number(offM));
  const wall = utcMs(date.year, date.month, date.day) + (Number(hh) * 60 + Number(mi)) * 60_000;
  const local = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayOf(wall - offsetMinutes * 60_000));
  return local ? calendarDay(Number(local[1]), Number(local[2]), Number(local[3])) : null;
}

function calendarDay(year: number, month: number, day: number): DueDate | null {
  if (year < MIN_DUE_YEAR || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return { iso: `${year}-${pad(month)}-${pad(day)}`, year, month, day };
}

function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function utcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

/** Whether the day is still ahead, is today, or has passed. */
export function dueState(due: DueDate, today: string): DueState {
  if (due.iso === today) return "today";
  return due.iso < today ? "overdue" : "upcoming";
}

/** What a row draws for a due day: the short text, its state, and the whole day. */
export interface DueLabel {
  text: string;
  state: DueState;
  /** The full date, for the label a screen reader speaks and the tooltip shows. */
  long: string;
}

/**
 * The day as the row writes it: day and short month, and the year only when it
 * is not this one. A row is narrow and almost every due day is this year's, so
 * the year would be noise on most of them — but a deadline a year out, or one
 * long missed, must not pass for this year's.
 */
export function dueLabel(due: DueDate, today: string, locale: string): DueLabel {
  const sameYear = today.slice(0, 4) === String(due.year);
  const at = utcMs(due.year, due.month, due.day);
  return {
    text: formatter(locale, sameYear ? "short" : "short-year").format(at),
    state: dueState(due, today),
    long: formatter(locale, "long").format(at)
  };
}

type Shape = "short" | "short-year" | "long";

const SHAPES: Record<Shape, Intl.DateTimeFormatOptions> = {
  short: { day: "numeric", month: "short" },
  "short-year": { day: "numeric", month: "short", year: "numeric" },
  long: { day: "numeric", month: "long", year: "numeric" }
};

/**
 * Building a formatter costs a fifth of a millisecond and a pane redraws on
 * every save, so a vault of deadlines would stall typing if each row built its
 * own. One per language and shape is all there ever are.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, shape: Shape): Intl.DateTimeFormat {
  const key = `${locale}|${shape}`;
  let made = formatters.get(key);
  if (!made) {
    made = new Intl.DateTimeFormat(locale, {
      ...SHAPES[shape],
      timeZone: "UTC",
      numberingSystem: "latn"
    });
    formatters.set(key, made);
  }
  return made;
}

/**
 * What the pane's due dates were drawn against: the day while they are shown,
 * nothing while they are not. The pane redraws when this differs from the one
 * it drew with, which is how a day turns overdue at midnight with nothing in
 * the vault changing.
 */
export function dueDrawKey(showing: boolean, today: string): string | null {
  return showing ? today : null;
}
