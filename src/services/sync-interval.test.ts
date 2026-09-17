import { beforeAll, describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import { isNoteDue, parseSyncEvery, planSourceCheck } from "./sync-interval";

beforeAll(() => setLanguage("en"));

function schedule(raw: unknown) {
  const result = parseSyncEvery(raw);
  if (result === null || !result.ok) throw new Error(`not a schedule: ${JSON.stringify(raw)}`);
  return result.schedule;
}

const HOUR = 60;
const DAY = 60 * 24;

describe("what a note may say about how often it is checked", () => {
  it("reads a count and a unit, in either language", () => {
    expect(schedule("Every 2 days")).toMatchObject({ kind: "every", minutes: 2 * DAY });
    expect(schedule("Alle 2 Tage")).toMatchObject({ kind: "every", minutes: 2 * DAY });
    expect(schedule("jede 3 Stunden")).toMatchObject({ kind: "every", minutes: 3 * HOUR });
    expect(schedule("Every 1 week")).toMatchObject({ kind: "every", minutes: 7 * DAY });
  });

  it("reads a unit standing on its own as one of it", () => {
    expect(schedule("every week")).toMatchObject({ minutes: 7 * DAY });
    expect(schedule("Tag")).toMatchObject({ minutes: DAY });
  });

  it("reads the single words that are a whole schedule", () => {
    expect(schedule("daily")).toMatchObject({ minutes: DAY });
    expect(schedule("täglich")).toMatchObject({ minutes: DAY });
    expect(schedule("wöchentlich")).toMatchObject({ minutes: 7 * DAY });
    expect(schedule("monatlich")).toMatchObject({ minutes: 30 * DAY });
  });

  it("says the phrase back as cron, for a person to check their meaning against", () => {
    expect(schedule("every 2 days").cron).toBe("0 0 */2 * *");
    expect(schedule("every 6 hours").cron).toBe("0 */6 * * *");
    expect(schedule("weekly").cron).toBe("0 0 * * 0");
    expect(schedule("every 15 minutes").cron).toBe("*/15 * * * *");
  });

  it("says a fortnight in days, which is the nearest cron can come", () => {
    // Cron cannot count weeks, and counting fourteen days is what a person
    // writing this by hand would have done.
    expect(schedule("every 2 weeks")).toMatchObject({ minutes: 14 * DAY, cron: "0 0 */14 * *" });
  });

  it("takes a five-field cron expression as itself", () => {
    const weekdays = schedule("0 9 * * 1-5");

    expect(weekdays.kind).toBe("cron");
    expect(weekdays.cron).toBe("0 9 * * 1-5");
  });

  it("tells a note that says nothing from one that says something unreadable", () => {
    // The first wants the setting's interval; the second wants somebody told.
    expect(parseSyncEvery(undefined)).toBeNull();
    expect(parseSyncEvery("   ")).toBeNull();
    expect(parseSyncEvery("sometimes")).toMatchObject({ ok: false });
    expect(parseSyncEvery("every second tuesday")).toMatchObject({ ok: false });
    expect(parseSyncEvery(["every 2 days"])).toMatchObject({ ok: false });
  });

  it("refuses an interval shorter than a minute rather than checking in a loop", () => {
    expect(parseSyncEvery("every 0 days")).toMatchObject({ ok: false });
    expect(parseSyncEvery(0)).toMatchObject({ ok: false });
  });

  it("refuses a cron expression that is not one", () => {
    expect(parseSyncEvery("0 9 * * 9")).toMatchObject({ ok: false });
  });
});

describe("when a note is due", () => {
  const now = new Date(2026, 8, 13, 12, 0, 0);

  it("is due when it has never been checked, whatever it says", () => {
    expect(isNoteDue(schedule("every 2 days"), undefined, now)).toBe(true);
    expect(isNoteDue(schedule("0 9 * * 1-5"), undefined, now)).toBe(true);
  });

  it("holds a phrase to its interval, counted from the last check", () => {
    const twoDays = schedule("every 2 days");

    expect(isNoteDue(twoDays, now.getTime() - 2 * DAY * 60_000, now)).toBe(true);
    expect(isNoteDue(twoDays, now.getTime() - 47 * HOUR * 60_000, now)).toBe(false);
  });

  it("counts from the check and not from the clock, so a sleeping device catches up", () => {
    // The whole reason words are a floor: this note was due at three in the
    // morning with the phone off, and is due now rather than in two days.
    const daily = schedule("daily");
    const threeDaysAgo = now.getTime() - 3 * DAY * 60_000;

    expect(isNoteDue(daily, threeDaysAgo, now)).toBe(true);
  });

  it("holds cron to the last moment it named", () => {
    const nine = schedule("0 9 * * *");

    // Checked at eight, and nine has since gone by.
    expect(isNoteDue(nine, new Date(2026, 8, 13, 8, 0, 0).getTime(), now)).toBe(true);
    // Checked at ten, after that moment: nothing named has passed since.
    expect(isNoteDue(nine, new Date(2026, 8, 13, 10, 0, 0).getTime(), now)).toBe(false);
  });
});

describe("a check asked for by hand", () => {
  const record = {
    hash: "aaaaaaaa",
    etag: '"v1"',
    checkedAt: 0,
    pendingChanges: 0,
    remoteHash: "bbbbbbbb"
  };
  const base = { record, schedule: null, minIntervalMinutes: 10, now: new Date(2026, 8, 17) };

  it("fetches the whole document when the note no longer holds it", () => {
    // An accepted update that never reached the file left the record settled
    // on a text the note does not have; "unchanged" would keep it that way.
    expect(planSourceCheck({ ...base, noteBodyHash: "00000000" }).etag).toBeUndefined();
  });

  it("stays conditional when the note matches what the source last sent", () => {
    expect(planSourceCheck({ ...base, noteBodyHash: "bbbbbbbb" }).etag).toBe('"v1"');
  });

  it("stays conditional when no note body is given, as for a poll", () => {
    expect(planSourceCheck(base).etag).toBe('"v1"');
  });
});
