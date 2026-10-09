/**
 * The day a note is due, for a row in the file pane.
 *
 * A note says it with one frontmatter key and the Explorer shows the day
 * beside its name. Nothing reminds and nothing schedules: the date is there to
 * be seen while looking down a list, the way the task count is.
 *
 * Only the day counts. A date-and-time property is due on its day, because a
 * row cannot show an hour without becoming a clock nobody asked for, and a
 * time zone suffix is ignored for the same reason: the day the person typed is
 * the day they meant, wherever the laptop is today.
 */

/** Frontmatter a note carries to say when it is due. */
export const DUE_KEY = "schreibstubeDue";

/**
 * Longer than any date or date-and-time Obsidian writes. A value past it is
 * not a date, and the pattern below never has to look at a pasted paragraph.
 */
export const MAX_DUE_LENGTH = 40;

/**
 * `YYYY-MM-DD`, optionally followed by a time as the date-and-time property
 * writes it, with or without seconds, fraction and offset.
 */
const DUE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

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

/**
 * The due day a note's frontmatter names, or null when it names none. A value
 * that is not a real calendar day — `2026-02-30`, a word, a list — is null as
 * well, so a typo shows nothing rather than a date the person did not write.
 */
export function dueDateOf(frontmatter: unknown): DueDate | null {
  if (!frontmatter || typeof frontmatter !== "object") return null;
  const value = (frontmatter as Record<string, unknown>)[DUE_KEY];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > MAX_DUE_LENGTH) return null;

  const match = DUE_PATTERN.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  return { iso: trimmed.slice(0, 10), year, month, day };
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today as `YYYY-MM-DD` on the local calendar, which is the one the person reads. */
export function localIsoDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whether the day is still ahead, is today, or has passed. */
export function dueState(due: DueDate, today: string): DueState {
  if (due.iso === today) return "today";
  return due.iso < today ? "overdue" : "upcoming";
}

/**
 * The day as the row writes it: day and short month, and the year only when it
 * is not this one. A row is narrow and almost every due day is this year's, so
 * the year would be noise on most of them — but a deadline a year out, or one
 * long missed, must not pass for this year's.
 */
export function formatDueDate(due: DueDate, today: string, locale: string): string {
  const sameYear = today.slice(0, 4) === String(due.year).padStart(4, "0");
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
    numberingSystem: "latn"
  }).format(Date.UTC(due.year, due.month - 1, due.day));
}

/** The whole day, for the label a screen reader speaks and the tooltip shows. */
export function formatDueDateLong(due: DueDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
    numberingSystem: "latn"
  }).format(Date.UTC(due.year, due.month - 1, due.day));
}
