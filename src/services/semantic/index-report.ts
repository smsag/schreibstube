/**
 * What the settings tab says about the index, beyond one status sentence.
 *
 * "Ready: 412 notes" answers whether search by meaning works, and nothing a
 * person needs when it is slow or misses a note: how much of the vault is in
 * it and why the rest is not, how big it is and which device keeps it, how
 * fast the model reads on this device, and how long the rest will take. Those
 * are facts the engine has; this turns them into rows. Pure, so the arithmetic
 * — rates, the time left, the shares — is tested rather than read off a phone.
 */
import type { IndexKeeper } from "./embedding-index";
import type { Messages } from "../../i18n";

/** How far a build has come. */
export interface BuildProgress {
  /** Notes looked at so far, and in all. */
  done: number;
  total: number;
  /** Notes sent to the model, reused unchanged, and given up on. */
  embedded: number;
  reused: number;
  failed: number;
  /** Passages the model embedded. */
  passages: number;
}

/** One build, running or finished. */
export interface BuildRecord extends BuildProgress {
  /** A full build, or the desktop's catch-up at launch. */
  kind: "build" | "catchUp";
  startedAt: number;
  /** Null while it runs. */
  endedAt: number | null;
  /** Stopped at a phone's budget. */
  stopped: boolean;
  /** Why it failed, when it did. */
  error: string | null;
}

/** Everything the report is drawn from. */
export interface IndexFacts {
  /** The model's name as the settings offer it, and the backend running it. */
  model: string;
  backend: string | null;
  device: IndexKeeper;
  /** Markdown notes in the vault. */
  vaultNotes: number;
  /** Notes kept out by their frontmatter. */
  optedOut: number;
  /** Notes past the note limit, and the limit. */
  overCap: number;
  cap: number;
  /** Notes the index should hold, and how many of them it does. */
  inScope: number;
  indexed: number;
  /** In scope, held as failed. */
  failed: number;
  /** In scope, not read yet. */
  missing: number;
  /** Passages held for the notes in scope. */
  passages: number;
  /** File sizes in bytes; null when the file is not there. */
  indexBytes: number | null;
  journalBytes: number | null;
  phoneJournalBytes: number | null;
  keeper?: IndexKeeper | undefined;
  writtenAt?: number | undefined;
  build: BuildRecord | null;
  /** The Explorer filter's text index, when the pane has read it. */
  text: { notes: number; words: number } | null;
}

export interface ReportRow {
  label: string;
  value: string;
}

type Strings = Messages["semantic"]["report"];

/** A share as a whole percent, 0 for nothing of nothing. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Passages a second over a stretch of time, or null when too short to say. */
export function passageRate(passages: number, ms: number): number | null {
  if (passages <= 0 || ms < 1000) return null;
  return passages / (ms / 1000);
}

/**
 * The time a running build still needs, from the pace so far.
 *
 * Paced by notes rather than passages: which notes are left and how long they
 * are is not known until each is read. Null until a few notes have been
 * looked at, since one long note first would otherwise promise hours.
 */
export function remainingMs(progress: BuildProgress, elapsedMs: number): number | null {
  const MIN_DONE = 5;
  if (progress.done < MIN_DONE || progress.done >= progress.total || elapsedMs <= 0) return null;
  return (elapsedMs / progress.done) * (progress.total - progress.done);
}

/** A byte count as KB or MB. */
export function formatBytes(bytes: number, decimal: (n: number) => string): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${decimal(bytes / (1024 * 1024))} MB`;
}

/** A duration as seconds, minutes or hours, at the precision that matters. */
export function formatDuration(ms: number, s: Strings): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return s.seconds(Math.max(1, seconds));
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return s.minutes(minutes);
  return s.hours(Math.floor(minutes / 60), minutes % 60);
}

/** The rows, in the order they are read: coverage first, then speed. */
export function reportRows(f: IndexFacts, s: Strings, now: number): ReportRow[] {
  const rows: ReportRow[] = [];
  rows.push({
    label: s.coverage,
    value: s.coverageValue(f.indexed, f.inScope, percent(f.indexed, f.inScope))
  });
  rows.push({ label: s.vault, value: s.vaultValue(f.vaultNotes, f.optedOut, f.overCap, f.cap) });
  if (f.missing > 0 || f.failed > 0) {
    rows.push({ label: s.notIndexed, value: s.notIndexedValue(f.missing, f.failed) });
  }
  if (f.indexed > 0) {
    rows.push({
      label: s.passages,
      value: s.passagesValue(f.passages, s.decimal(f.passages / f.indexed))
    });
  }
  if (f.indexBytes !== null) {
    const journals = (f.journalBytes ?? 0) + (f.phoneJournalBytes ?? 0);
    rows.push({
      label: s.file,
      value: s.fileValue(
        formatBytes(f.indexBytes, s.decimal),
        journals > 0 ? formatBytes(journals, s.decimal) : null,
        f.keeper ?? null,
        f.writtenAt ?? null
      )
    });
  }
  rows.push({ label: s.model, value: s.modelValue(f.model, f.backend, f.device) });

  const b = f.build;
  if (b) {
    const elapsed = (b.endedAt ?? now) - b.startedAt;
    const rate = passageRate(b.passages, elapsed);
    const pace = rate === null ? null : s.decimal(rate);
    const counts = s.buildCounts(b.embedded, b.reused, b.failed);
    if (b.endedAt === null) {
      const left = remainingMs(b, elapsed);
      rows.push({
        label: s.building,
        value: s.buildingValue(
          b.done,
          b.total,
          counts,
          pace,
          left === null ? null : formatDuration(left, s)
        )
      });
    } else {
      rows.push({
        label: b.kind === "catchUp" ? s.lastCatchUp : s.lastBuild,
        value: s.lastBuildValue(
          b.endedAt,
          formatDuration(elapsed, s),
          counts,
          pace,
          b.stopped,
          b.error
        )
      });
    }
  }
  rows.push({
    label: s.textSearch,
    value: f.text ? s.textSearchValue(f.text.notes, f.text.words) : s.textSearchUnread
  });
  return rows;
}
