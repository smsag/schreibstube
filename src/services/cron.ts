/**
 * A small cron parser and matcher for the background poll schedule.
 *
 * Obsidian has no scheduler, so the plugin ticks and asks whether the current
 * minute matches. Expressing that as cron rather than a plain interval is what
 * lets a schedule say "weekday mornings" instead of "every 480 minutes since
 * whenever the app last started".
 *
 * Standard five fields: minute, hour, day of month, month, day of week.
 * Supported syntax is `*`, a number, a list, a range, and a step on either.
 */

export interface CronSchedule {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Cron's odd rule: when both day fields are restricted they are OR-ed, not
   *  AND-ed, so `0 9 1 * 1` fires on the first of the month and on Mondays. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

export type CronParseResult = { ok: true; schedule: CronSchedule } | { ok: false; reason: string };

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  /** Names accepted in place of numbers, lowercase, in value order from min. */
  names?: string[];
}

const FIELDS: FieldSpec[] = [
  { name: "Minute", min: 0, max: 59 },
  { name: "Stunde", min: 0, max: 23 },
  { name: "Tag des Monats", min: 1, max: 31 },
  {
    name: "Monat",
    min: 1,
    max: 12,
    names: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
  },
  {
    name: "Wochentag",
    min: 0,
    max: 7,
    names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
  }
];

/** A few schedules worth offering as a starting point. */
export const CRON_PRESETS: { label: string; expression: string }[] = [
  { label: "Stündlich", expression: "0 * * * *" },
  { label: "Alle 4 Stunden", expression: "0 */4 * * *" },
  { label: "Täglich 8:00", expression: "0 8 * * *" },
  { label: "Werktags 8:00", expression: "0 8 * * 1-5" }
];

export function parseCron(expression: string): CronParseResult {
  const parts = expression.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, reason: "Kein Ausdruck angegeben." };
  }
  if (parts.length !== 5) {
    return {
      ok: false,
      reason: `Fünf Felder erwartet (Minute Stunde Tag Monat Wochentag), ${parts.length} gefunden.`
    };
  }

  const sets: Set<number>[] = [];
  for (let i = 0; i < FIELDS.length; i += 1) {
    const parsed = parseField(parts[i], FIELDS[i]);
    if (!parsed) {
      return { ok: false, reason: `Feld ${FIELDS[i].name}: "${parts[i]}" ist ungültig.` };
    }
    sets.push(parsed);
  }

  // Sunday is both 0 and 7 in cron; normalize so matching only has to check 0.
  const dayOfWeek = new Set<number>();
  for (const value of sets[4]) {
    dayOfWeek.add(value === 7 ? 0 : value);
  }

  return {
    ok: true,
    schedule: {
      minute: sets[0],
      hour: sets[1],
      dayOfMonth: sets[2],
      month: sets[3],
      dayOfWeek,
      dayOfMonthRestricted: parts[2] !== "*",
      dayOfWeekRestricted: parts[4] !== "*"
    }
  };
}

/** True when `date` falls in a minute the schedule names. */
export function matchesCron(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.minute.has(date.getMinutes())) return false;
  if (!schedule.hour.has(date.getHours())) return false;
  if (!schedule.month.has(date.getMonth() + 1)) return false;

  const domMatch = schedule.dayOfMonth.has(date.getDate());
  const dowMatch = schedule.dayOfWeek.has(date.getDay());

  if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) {
    return domMatch || dowMatch;
  }
  if (schedule.dayOfMonthRestricted) return domMatch;
  if (schedule.dayOfWeekRestricted) return dowMatch;
  return true;
}

/** How long to search before giving up on a schedule that never comes round,
 *  such as the 30th of February. */
const MAX_LOOKAHEAD_MINUTES = 366 * 24 * 60;

/** The next minute at or after `from` that the schedule names, or null. */
export function nextRun(schedule: CronSchedule, from: Date): Date | null {
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES; i += 1) {
    if (matchesCron(schedule, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

/**
 * The most recent minute at or before `from` that the schedule named, or null.
 *
 * A desktop app is closed most of the time, so a daily schedule would never run
 * for someone who opens Obsidian after it passed. Comparing this against when
 * the poll last ran is what lets a missed schedule be caught up once on load.
 */
export function previousRun(schedule: CronSchedule, from: Date): Date | null {
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);

  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES; i += 1) {
    if (matchesCron(schedule, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() - 1);
  }

  return null;
}

/**
 * Whether a tick should fire.
 *
 * The ticker runs more often than once a minute so a schedule is not missed
 * when a tick drifts, which means the same minute can be seen several times.
 * `lastFiredMinute` is the guard: one fire per named minute, no more.
 */
export function shouldFire(schedule: CronSchedule, now: Date, lastFiredMinute: number): boolean {
  const minuteStamp = minuteOf(now);
  if (minuteStamp === lastFiredMinute) return false;
  return matchesCron(schedule, now);
}

/** Minutes since the epoch, the identity of a single minute. */
export function minuteOf(date: Date): number {
  return Math.floor(date.getTime() / 60_000);
}

function parseField(raw: string, spec: FieldSpec): Set<number> | null {
  const values = new Set<number>();

  for (const part of raw.split(",")) {
    if (part.length === 0) return null;

    const [rangePart, stepPart, ...extra] = part.split("/");
    if (extra.length > 0) return null;

    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step < 1) return null;
    }

    let start: number;
    let end: number;

    if (rangePart === "*") {
      start = spec.min;
      end = spec.max;
    } else if (rangePart.includes("-")) {
      const [fromRaw, toRaw, ...rest] = rangePart.split("-");
      if (rest.length > 0) return null;
      const from = toValue(fromRaw, spec);
      const to = toValue(toRaw, spec);
      if (from === null || to === null || from > to) return null;
      start = from;
      end = to;
    } else {
      const single = toValue(rangePart, spec);
      if (single === null) return null;
      start = single;
      // A bare value with a step means "from here to the end of the field",
      // which is how `5/15` reads in cron.
      end = stepPart === undefined ? single : spec.max;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return values.size > 0 ? values : null;
}

function toValue(raw: string, spec: FieldSpec): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  if (spec.names) {
    const index = spec.names.indexOf(trimmed);
    if (index !== -1) {
      return spec.name === "Monat" ? index + 1 : index;
    }
  }

  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= spec.min && value <= spec.max ? value : null;
}
