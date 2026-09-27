import { describe, expect, it } from "vitest";
import { en } from "../../i18n/en";
import { enExtra } from "../../i18n/en-extra";
import { de } from "../../i18n/de";
import {
  formatBytes,
  formatDuration,
  formatMs,
  passageRate,
  percent,
  remainingMs,
  reportRows,
  type BuildRecord,
  type IndexFacts
} from "./index-report";

const s = { ...en, ...enExtra }.semantic.report;

const facts: IndexFacts = {
  model: "Multilingual",
  backend: "worker (blob)",
  device: "desktop",
  vaultNotes: 280,
  optedOut: 4,
  overCap: 0,
  cap: 5000,
  inScope: 276,
  indexed: 250,
  failed: 2,
  missing: 24,
  passages: 1000,
  indexBytes: 2.5 * 1024 * 1024,
  journalBytes: 12 * 1024,
  phoneJournalBytes: null,
  keeper: "desktop",
  writtenAt: Date.UTC(2026, 8, 27, 12, 0),
  build: null,
  search: null,
  text: { notes: 256, words: 18_402, readMs: null }
};

const build = (over: Partial<BuildRecord>): BuildRecord => ({
  kind: "build",
  startedAt: 0,
  endedAt: null,
  stopped: false,
  error: null,
  done: 0,
  total: 276,
  embedded: 0,
  reused: 0,
  failed: 0,
  passages: 0,
  ...over
});

const value = (rows: { label: string; value: string }[], label: string): string =>
  rows.find((row) => row.label === label)?.value ?? "";

describe("the arithmetic", () => {
  it("gives shares, rates and the time left", () => {
    expect(percent(250, 276)).toBe(91);
    expect(percent(0, 0)).toBe(0);
    expect(passageRate(300, 60_000)).toBe(5);
    expect(passageRate(300, 500)).toBeNull();
    expect(passageRate(0, 60_000)).toBeNull();
    const progress = { done: 10, total: 30, embedded: 10, reused: 0, failed: 0, passages: 40 };
    expect(remainingMs(progress, 60_000)).toBe(120_000);
    expect(remainingMs({ ...progress, done: 2 }, 60_000)).toBeNull(); // too early to say
    expect(remainingMs({ ...progress, done: 30 }, 60_000)).toBeNull();
  });

  it("writes sizes and durations the way a person reads them", () => {
    expect(formatBytes(512, s.decimal)).toBe("1 KB");
    expect(formatBytes(12 * 1024, s.decimal)).toBe("12 KB");
    expect(formatBytes(2.5 * 1024 * 1024, s.decimal)).toBe("2.5 MB");
    expect(formatDuration(12_000, s)).toBe("12 s");
    expect(formatDuration(8 * 60_000, s)).toBe("8 min");
    expect(formatDuration(75 * 60_000, s)).toBe("1 h 15 min");
    expect(formatDuration(120 * 60_000, s)).toBe("2 h");
  });
});

describe("reportRows", () => {
  it("says how much of the vault is covered and why the rest is not", () => {
    const rows = reportRows(facts, s, 0);
    expect(value(rows, s.coverage)).toBe("250 of 276 notes (91 %)");
    expect(value(rows, s.vault)).toBe("280 notes; 4 kept out by their frontmatter");
    expect(value(rows, s.notIndexed)).toBe("24 not read yet; 2 failed, tried again once edited");
    expect(value(rows, s.passages)).toBe("1000, 4.0 per note");
    expect(value(rows, s.file)).toContain("2.5 MB plus 12 KB of edits; kept by the desktop");
    expect(value(rows, s.model)).toBe("Multilingual on this desktop; running in worker (blob)");
    expect(value(rows, s.textSearch)).toBe("256 notes read, 18402 different words");
  });

  it("leaves out what has nothing to say", () => {
    const rows = reportRows(
      { ...facts, missing: 0, failed: 0, indexed: 0, indexBytes: null, text: null, backend: null },
      s,
      0
    );
    const labels = rows.map((row) => row.label);
    expect(labels).not.toContain(s.notIndexed);
    expect(labels).not.toContain(s.passages);
    expect(labels).not.toContain(s.file);
    expect(value(rows, s.model)).toContain("not loaded");
    expect(value(rows, s.textSearch)).toBe(s.textSearchUnread);
  });

  it("names the limit when notes are past it", () => {
    const rows = reportRows({ ...facts, overCap: 30, cap: 250 }, s, 0);
    expect(value(rows, s.vault)).toContain("30 past the limit of 250");
  });

  it("shows a running build's pace and the time left", () => {
    const running = build({ done: 60, embedded: 50, reused: 10, passages: 300 });
    const rows = reportRows({ ...facts, build: running }, s, 60_000);
    expect(value(rows, s.building)).toBe(
      "60 of 276 notes; 50 embedded, 10 unchanged; 5.0 passages a second; about 4 min left"
    );
  });

  it("shows how the last build went, a stop at the phone's limit, and a failure", () => {
    const done = build({ done: 276, endedAt: 480_000, embedded: 276, passages: 1200, failed: 1 });
    expect(value(reportRows({ ...facts, build: done }, s, 0), s.lastBuild)).toContain(
      "took 8 min; 276 embedded, 0 unchanged, 1 failed; 2.5 passages a second"
    );
    const stopped = build({ endedAt: 60_000, embedded: 50, passages: 200, stopped: true });
    expect(value(reportRows({ ...facts, build: stopped }, s, 0), s.lastBuild)).toContain(
      "stopped at the phone's limit"
    );
    const failed = build({ endedAt: 5_000, error: "worker gone" });
    expect(value(reportRows({ ...facts, build: failed }, s, 0), s.lastBuild)).toContain(
      "failed after 5 s: worker gone"
    );
    const catchUp = build({ kind: "catchUp", endedAt: 5_000 });
    expect(reportRows({ ...facts, build: catchUp }, s, 0).map((r) => r.label)).toContain(
      s.lastCatchUp
    );
  });

  it("reads in German with a decimal comma", () => {
    const rows = reportRows(facts, de.semantic.report, 0);
    expect(value(rows, de.semantic.report.passages)).toBe("1000, 4,0 je Notiz");
    expect(value(rows, de.semantic.report.file)).toContain("2,5 MB");
  });
});

describe("where a search's time went", () => {
  const search = {
    at: 0,
    totalMs: 1240,
    loadMs: 900,
    embedMs: 180,
    rankMs: 4,
    cached: false,
    notes: 256,
    hits: 3
  };

  it("names the model's load, the query and the ranking", () => {
    const rows = reportRows({ ...facts, search }, s, 0);
    expect(value(rows, s.lastSearch)).toBe(
      "1.2 s; loading the model 900 ms; the query 180 ms; ranking 256 notes 4 ms; 3 found"
    );
  });

  it("says when nothing had to be loaded or embedded", () => {
    const rows = reportRows({ ...facts, search: { ...search, loadMs: 0, cached: true } }, s, 0);
    expect(value(rows, s.lastSearch)).toBe(
      "1.2 s; the query from memory; ranking 256 notes 4 ms; 3 found"
    );
  });

  it("says how long reading the text took", () => {
    const rows = reportRows({ ...facts, text: { notes: 256, words: 10, readMs: 1400 } }, s, 0);
    expect(value(rows, s.textSearch)).toBe("256 notes read in 1.4 s, 10 different words");
  });

  it("writes short durations in milliseconds", () => {
    expect(formatMs(4.4, s.decimal)).toBe("4 ms");
    expect(formatMs(999, s.decimal)).toBe("999 ms");
    expect(formatMs(1500, s.decimal)).toBe("1.5 s");
  });
});
