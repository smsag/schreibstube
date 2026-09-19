/**
 * How often one note's source is worth asking about.
 *
 * The poll's schedule says when the plugin looks at the vault; this says how
 * much of the vault is due when it does. A press release checked every ten
 * minutes and a contract checked every ten minutes are the same traffic and
 * only one of them is worth it, so the note itself gets to say.
 *
 * It is said in words, because frontmatter is written by a person: "Alle 2
 * Tage", "Every 2 days", "weekly". A five-field cron string is taken as well,
 * for the schedules words cannot reach — "weekdays at nine" is one of them.
 *
 * Words and cron do not mean the same kind of thing, and the difference is the
 * point rather than an oversight. Words set a floor: two days after the last
 * check, whenever the poll next looks. A device that was asleep at the hour
 * still catches up, and two days stays two days across the end of a month. Cron
 * names moments instead, and a note whose schedule named a moment is due once
 * that moment has passed unchecked.
 */
import { parseCron, previousRun, type CronSchedule } from "./cron";
import { t } from "../i18n";
import type { SyncRecord } from "./sync-document";

/** Where a note says how often it should be checked. */
export const SYNC_EVERY_KEY = "schreibstubeSyncEvery";

export type SyncSchedule =
  /** Words: at most this often, counted from the last check. */
  | { kind: "every"; minutes: number; cron: string; text: string }
  /** Cron: due once a named minute has gone by unchecked. */
  | { kind: "cron"; cron: string; schedule: CronSchedule };

export type SyncIntervalResult =
  { ok: true; schedule: SyncSchedule } | { ok: false; reason: string };

const MINUTES_PER = {
  minute: 1,
  hour: 60,
  day: 60 * 24,
  week: 60 * 24 * 7,
  month: 60 * 24 * 30
} as const;

type Unit = keyof typeof MINUTES_PER;

/**
 * The words each unit answers to, in both languages the plugin speaks.
 *
 * Written out rather than stemmed: a stemmer that turned "Montag" into a month
 * would be worse than a list nobody has to reason about.
 */
const UNITS: Record<Unit, string[]> = {
  minute: ["minute", "minutes", "min", "mins", "minuten"],
  hour: ["hour", "hours", "h", "hr", "hrs", "stunde", "stunden", "std"],
  day: ["day", "days", "d", "tag", "tage", "tagen"],
  week: ["week", "weeks", "w", "woche", "wochen"],
  month: ["month", "months", "monat", "monate", "monaten"]
};

/** Single words that are a whole schedule by themselves. */
const SHORTHANDS: Record<string, Unit> = {
  hourly: "hour",
  stündlich: "hour",
  stuendlich: "hour",
  daily: "day",
  täglich: "day",
  taeglich: "day",
  weekly: "week",
  wöchentlich: "week",
  woechentlich: "week",
  monthly: "month",
  monatlich: "month"
};

/** Openers a person writes and a parser can drop: "every 2 days" is "2 days". */
const OPENERS = ["every", "each", "all", "alle", "jede", "jeden", "jedes", "je"];

/**
 * What a note's `schreibstubeSyncEvery` says, or null when it says nothing.
 *
 * Null and a refusal are different answers: a note without the key wants the
 * setting's interval, while a note whose key cannot be read wants somebody to
 * be told. Nothing here falls back quietly on a value a person did write.
 */
export function parseSyncEvery(raw: unknown): SyncIntervalResult | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return everySchedule(raw, "minute", String(raw));

  if (typeof raw !== "string") return { ok: false, reason: t().sync.every.notWords };

  const text = raw.trim().toLowerCase();
  if (text.length === 0) return null;

  // Five fields is cron and nothing else: no phrase in either language has that
  // shape, so this cannot swallow one.
  const fields = text.split(/\s+/);
  if (fields.length === 5) {
    const parsed = parseCron(text);
    return parsed.ok
      ? {
          ok: true,
          schedule: { kind: "cron", cron: normalizeCron(fields), schedule: parsed.schedule }
        }
      : { ok: false, reason: parsed.reason };
  }

  const words = fields.filter((word) => !OPENERS.includes(word.replace(/[.,;]$/, "")));
  const [firstWord = ""] = words;
  const shorthand = words.length === 1 ? SHORTHANDS[firstWord] : undefined;
  if (shorthand) return everySchedule(1, shorthand, raw.trim());

  // "2 days", and "days" on its own, which reads as one of them.
  const count = words.length === 2 ? Number(firstWord.replace(",", ".")) : 1;
  const unitWord = words[words.length - 1] ?? "";
  const unit = unitOf(unitWord);

  if (words.length > 2 || unit === null || !Number.isFinite(count)) {
    return { ok: false, reason: t().sync.every.notWords };
  }

  return everySchedule(count, unit, raw.trim());
}

/** Whether a note is due, by what its own key said. */
export function isNoteDue(
  schedule: SyncSchedule,
  checkedAt: number | undefined,
  now: Date
): boolean {
  if (checkedAt === undefined) return true;

  if (schedule.kind === "every") {
    return now.getTime() - checkedAt >= schedule.minutes * 60_000;
  }

  // The last moment the schedule named. Due when that moment came and went
  // without a check — which is what keeps a device that was off from missing
  // the round entirely.
  const last = previousRun(schedule.schedule, now);
  return last !== null && last.getTime() > checkedAt;
}

/**
 * Whether enough time has passed to check this note's source again.
 *
 * Zero means every open, which is the setting for a source that changes often.
 * A note with no record has never been checked, so it is always due.
 */
export function isCheckDue(
  record: SyncRecord | undefined,
  minIntervalMinutes: number,
  now = Date.now()
): boolean {
  if (!record || minIntervalMinutes <= 0) return true;
  return now - record.checkedAt >= minIntervalMinutes * 60_000;
}

export interface SourceCheckInput {
  record: SyncRecord | undefined;
  /** What the note itself asks for, or null when it says nothing. */
  schedule: SyncSchedule | null;
  /** The setting that applies when the note says nothing. */
  minIntervalMinutes: number;
  now: Date;
  /**
   * The hash of the note's body, given when a person asked for this check.
   * A note that no longer holds what the source last sent is then fetched
   * whole, because an "unchanged" answer has nothing to offer it back.
   */
  noteBodyHash?: string | undefined;
}

export interface SourceCheckPlan {
  due: boolean;
  /** The validator to send, or none when the fetch must be unconditional. */
  etag: string | undefined;
}

/**
 * Whether to check a source now, and how.
 *
 * Two callers — the poll over the vault and the check on the note in front of
 * you — each answered this with the same two lines, and two copies of a rule
 * is one more than it needs. What the note asks for comes first; the setting
 * applies when it says nothing. And a poll that found changes has already
 * advanced the validator, so asking conditionally would answer "unchanged"
 * and lose the update: the fetch is unconditional until those changes have
 * been looked at.
 */
export function planSourceCheck(input: SourceCheckInput): SourceCheckPlan {
  const { record, schedule, minIntervalMinutes, now } = input;
  const due =
    schedule === null
      ? isCheckDue(record, minIntervalMinutes, now.getTime())
      : isNoteDue(schedule, record?.checkedAt, now);
  // A note that lost the text it was settled on — an accepted update that
  // never reached the file — answers "unchanged" on every conditional check
  // until the source itself moves. Asked by hand, it gets the document again.
  const lostTheSource =
    input.noteBodyHash !== undefined &&
    record?.remoteHash !== undefined &&
    input.noteBodyHash !== record.remoteHash;
  const etag = (record?.pendingChanges ?? 0) > 0 || lostTheSource ? undefined : record?.etag;
  return { due, etag };
}

/** The phrase as cron says it, for showing a person what they asked for. */
function everySchedule(count: number, unit: Unit, text: string): SyncIntervalResult {
  const whole = Math.floor(count);
  // Not `whole < 1`, which lets both Infinity and NaN through: YAML reads
  // `.inf` and `.nan` as numbers, so a note can hand this either, and an
  // interval of neither-a-number is one the note is never due again on —
  // silently, while the panel reports the schedule as understood.
  if (!Number.isFinite(whole) || whole < 1) {
    return { ok: false, reason: t().sync.every.tooSmall };
  }

  return {
    ok: true,
    schedule: {
      kind: "every",
      minutes: whole * MINUTES_PER[unit],
      cron: cronFor(whole, unit),
      // Shown back as it was written: the plugin's job is to say whether it
      // understood a person, not to correct their phrasing at them.
      text
    }
  };
}

/**
 * The cron a phrase stands for, as near as cron can say it.
 *
 * Near, and not the same: cron counts days from the first of the month, so a
 * step on the day field is one day apart across a month's end rather than two.
 * The schedule the plugin keeps is the phrase; this is how the phrase reads
 * back.
 */
function cronFor(count: number, unit: Unit): string {
  switch (unit) {
    case "minute":
      return count < 60 ? `*/${count} * * * *` : cronFor(Math.round(count / 60), "hour");
    case "hour":
      return count < 24 ? `0 */${count} * * *` : cronFor(Math.round(count / 24), "day");
    case "day":
      return `0 0 */${count} * *`;
    case "week":
      return count === 1 ? "0 0 * * 0" : `0 0 */${count * 7} * *`;
    case "month":
      return `0 0 1 */${count} *`;
  }
}

function unitOf(word: string): Unit | null {
  const clean = word.replace(/[.,;]$/, "");

  for (const [unit, names] of Object.entries(UNITS)) {
    if (names.includes(clean)) return unit as Unit;
  }

  return null;
}

/** The person's own spacing tidied, so what is shown back is one expression. */
function normalizeCron(fields: readonly string[]): string {
  return fields.join(" ");
}
