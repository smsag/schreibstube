import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import {
  cronPresets,
  matchesCron,
  minuteOf,
  nextRun,
  parseCron,
  previousRun,
  shouldFire,
  type CronSchedule
} from "./cron";

// The refusals are read by a person, so they are translated; the suite fixes a
// language rather than asserting whichever one happens to be set.
setLanguage("en");

function schedule(expression: string): CronSchedule {
  const result = parseCron(expression);
  if (!result.ok) throw new Error(`expected a valid expression: ${result.reason}`);
  return result.schedule;
}

function reason(expression: string): string {
  const result = parseCron(expression);
  if (result.ok) throw new Error("expected a rejection");
  return result.reason;
}

/** Local time, since a cron schedule means the user's wall clock. */
function at(iso: string): Date {
  const [date, time] = iso.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

describe("parseCron", () => {
  it("accepts every wildcard", () => {
    expect(schedule("* * * * *").minute.size).toBe(60);
  });

  it("accepts a single value", () => {
    expect([...schedule("5 * * * *").minute]).toEqual([5]);
  });

  it("accepts a list", () => {
    expect([...schedule("0,15,30 * * * *").minute]).toEqual([0, 15, 30]);
  });

  it("accepts a range", () => {
    expect([...schedule("* 9-11 * * *").hour]).toEqual([9, 10, 11]);
  });

  it("accepts a step on a wildcard", () => {
    expect([...schedule("*/15 * * * *").minute]).toEqual([0, 15, 30, 45]);
  });

  it("accepts a step on a range", () => {
    expect([...schedule("* 8-16/4 * * *").hour]).toEqual([8, 12, 16]);
  });

  it("reads a bare value with a step as running to the end of the field", () => {
    expect([...schedule("5/15 * * * *").minute]).toEqual([5, 20, 35, 50]);
  });

  it("accepts month and weekday names", () => {
    expect([...schedule("0 0 * jan mon").month]).toEqual([1]);
    expect([...schedule("0 0 * jan mon").dayOfWeek]).toEqual([1]);
  });

  it("normalizes Sunday as seven to zero", () => {
    expect([...schedule("0 0 * * 7").dayOfWeek]).toEqual([0]);
  });

  it("records which day fields are restricted", () => {
    const both = schedule("0 9 1 * 1");
    expect(both.dayOfMonthRestricted).toBe(true);
    expect(both.dayOfWeekRestricted).toBe(true);
    const neither = schedule("0 9 * * *");
    expect(neither.dayOfMonthRestricted).toBe(false);
    expect(neither.dayOfWeekRestricted).toBe(false);
  });

  it("rejects the wrong number of fields", () => {
    expect(reason("* * * *")).toContain("Five fields");
    expect(reason("* * * * * *")).toContain("Five fields");
  });

  it("rejects an empty expression", () => {
    expect(reason("   ")).toContain("No expression");
  });

  it("rejects an out-of-range value", () => {
    expect(reason("60 * * * *")).toContain("Minute");
    expect(reason("* 24 * * *")).toContain("Hour");
    expect(reason("* * 32 * *")).toContain("Day of month");
    expect(reason("* * * 13 *")).toContain("Month");
    expect(reason("* * * * 8")).toContain("Weekday");
  });

  it("rejects an inverted range", () => {
    expect(reason("* 11-9 * * *")).toContain("Hour");
  });

  it("rejects a zero or negative step", () => {
    expect(reason("*/0 * * * *")).toContain("Minute");
  });

  it("rejects nonsense", () => {
    expect(reason("jeden tag um acht")).toContain("Five fields");
    expect(reason("a * * * *")).toContain("Minute");
  });

  it("parses every preset", () => {
    for (const preset of cronPresets()) {
      expect(parseCron(preset.expression).ok).toBe(true);
    }
  });
});

describe("matchesCron", () => {
  it("matches an hourly schedule only on the hour", () => {
    const hourly = schedule("0 * * * *");
    expect(matchesCron(hourly, at("2026-09-11 13:00"))).toBe(true);
    expect(matchesCron(hourly, at("2026-09-11 13:01"))).toBe(false);
  });

  it("matches a weekday morning schedule", () => {
    const weekdays = schedule("0 8 * * 1-5");
    expect(matchesCron(weekdays, at("2026-09-11 08:00"))).toBe(true);
    expect(matchesCron(weekdays, at("2026-09-12 08:00"))).toBe(false);
  });

  it("ORs the day fields when both are restricted", () => {
    const both = schedule("0 9 1 * 1");
    expect(matchesCron(both, at("2026-09-01 09:00"))).toBe(true);
    expect(matchesCron(both, at("2026-09-07 09:00"))).toBe(true);
    expect(matchesCron(both, at("2026-09-09 09:00"))).toBe(false);
  });

  it("uses only the day of month when the weekday is a wildcard", () => {
    const first = schedule("0 9 1 * *");
    expect(matchesCron(first, at("2026-09-01 09:00"))).toBe(true);
    expect(matchesCron(first, at("2026-09-07 09:00"))).toBe(false);
  });

  it("honours the month field", () => {
    const january = schedule("0 0 * 1 *");
    expect(matchesCron(january, at("2026-01-05 00:00"))).toBe(true);
    expect(matchesCron(january, at("2026-02-05 00:00"))).toBe(false);
  });
});

describe("nextRun", () => {
  it("finds the next hourly slot", () => {
    const next = nextRun(schedule("0 * * * *"), at("2026-09-11 13:20"));
    expect(next?.getHours()).toBe(14);
    expect(next?.getMinutes()).toBe(0);
  });

  it("never returns the current minute", () => {
    const next = nextRun(schedule("* * * * *"), at("2026-09-11 13:20"));
    expect(next?.getMinutes()).toBe(21);
  });

  it("rolls over to the next day", () => {
    const next = nextRun(schedule("0 8 * * *"), at("2026-09-11 09:00"));
    expect(next?.getDate()).toBe(12);
    expect(next?.getHours()).toBe(8);
  });

  it("skips the weekend for a weekday schedule", () => {
    const next = nextRun(schedule("0 8 * * 1-5"), at("2026-09-12 09:00"));
    expect(next?.getDay()).toBe(1);
  });

  it("returns null for a schedule that never comes round", () => {
    expect(nextRun(schedule("0 0 30 2 *"), at("2026-09-11 09:00"))).toBe(null);
  });
});

describe("previousRun", () => {
  it("finds the most recent hourly slot", () => {
    const previous = previousRun(schedule("0 * * * *"), at("2026-09-11 13:20"));
    expect(previous?.getHours()).toBe(13);
    expect(previous?.getMinutes()).toBe(0);
  });

  it("returns the current minute when it matches", () => {
    const previous = previousRun(schedule("0 * * * *"), at("2026-09-11 13:00"));
    expect(previous?.getHours()).toBe(13);
  });

  it("rolls back to the previous day", () => {
    const previous = previousRun(schedule("0 8 * * *"), at("2026-09-11 07:00"));
    expect(previous?.getDate()).toBe(10);
    expect(previous?.getHours()).toBe(8);
  });

  it("skips back over the weekend for a weekday schedule", () => {
    const previous = previousRun(schedule("0 8 * * 1-5"), at("2026-09-13 09:00"));
    expect(previous?.getDay()).toBe(5);
  });

  it("returns null for a schedule that never comes round", () => {
    expect(previousRun(schedule("0 0 30 2 *"), at("2026-09-11 09:00"))).toBe(null);
  });
});

describe("shouldFire", () => {
  const hourly = schedule("0 * * * *");

  it("fires on a matching minute not yet fired", () => {
    const now = at("2026-09-11 13:00");
    expect(shouldFire(hourly, now, 0)).toBe(true);
  });

  it("does not fire twice in the same minute", () => {
    const now = at("2026-09-11 13:00");
    expect(shouldFire(hourly, now, minuteOf(now))).toBe(false);
  });

  it("does not fire on a minute the schedule does not name", () => {
    expect(shouldFire(hourly, at("2026-09-11 13:30"), 0)).toBe(false);
  });

  it("fires again the next matching minute", () => {
    const first = at("2026-09-11 13:00");
    const second = at("2026-09-11 14:00");
    expect(shouldFire(hourly, second, minuteOf(first))).toBe(true);
  });
});
