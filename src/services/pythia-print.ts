/**
 * What printing asks of Pythia, and what it accepts back.
 *
 * Pythia links passages of a note to its conversations, and can hand a print a
 * copy of the note with each link's summary as a footnote. It publishes that
 * as an API on its plugin object; `readPythiaPrintApi` in
 * `workspace-internals.ts` finds it. Everything here is about the answers:
 * another plugin's return values are untrusted like any other input, so each
 * one is checked and bounded before the print uses it, and anything that does
 * not fit reads as "Pythia is not there" rather than a broken print.
 *
 * A print never changes the note: the copy is Pythia's to make, and only the
 * printed text sees it.
 */

/** The API as Pythia publishes it, version 1. Every result is `unknown` until checked. */
export interface PythiaPrintApi {
  readonly version: 1;
  inspectForExport(markdown: string, sourcePath?: string): unknown;
  refreshSummaries(
    markdown: string,
    options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
  ): Promise<unknown>;
  withExportFootnotes(markdown: string): unknown;
}

/** What a note holds, for the dialog: links, and summaries a refresh could write. */
export interface PythiaInspection {
  links: number;
  outdated: number;
  missing: number;
}

/** What a refresh did. */
export interface PythiaRefresh {
  refreshed: number;
  failed: number;
}

/** Past this, a count is not a count a note could hold. */
export const MAX_PYTHIA_COUNT = 100_000;

/** A copy may add footnotes, never this much: past it the answer is refused. */
export const MAX_PYTHIA_COPY_GROWTH = 1_000_000;

/**
 * How long the summaries may take. Pythia writes at most twenty per call,
 * three at a time, on a fast model; this is the ceiling for a slow network,
 * after which the dialog stops waiting and says so.
 */
export const PYTHIA_REFRESH_DEADLINE_MS = 180_000;

function count(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_PYTHIA_COUNT
    ? value
    : null;
}

/** Pythia's `inspectForExport` answer, or null when it is not one. */
export function checkInspection(raw: unknown): PythiaInspection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const links = count(r.links);
  const outdated = count(r.outdated);
  const missing = count(r.missing);
  if (links === null || outdated === null || missing === null) return null;
  return { links, outdated, missing };
}

/**
 * Pythia's copy of the note for printing, or null when it is not one: text,
 * and not grown beyond what footnotes could add.
 */
export function checkExportCopy(raw: unknown, source: string): string | null {
  if (typeof raw !== "string") return null;
  return raw.length <= source.length + MAX_PYTHIA_COPY_GROWTH ? raw : null;
}

/** Pythia's `refreshSummaries` answer, or null when it is not one. */
export function checkRefresh(raw: unknown): PythiaRefresh | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const refreshed = count(r.refreshed);
  if (refreshed === null || !Array.isArray(r.failed)) return null;
  return { refreshed, failed: Math.min(r.failed.length, MAX_PYTHIA_COUNT) };
}

/** Whether the dialog offers the footnotes at all: only for a note with links. */
export function offersPythia(inspection: PythiaInspection | null): inspection is PythiaInspection {
  return inspection !== null && inspection.links > 0;
}

/**
 * The text a print converts. With the footnotes on and Pythia's copy usable,
 * the copy; otherwise the note as it is, and `unavailable` says why the
 * footnotes are missing so the dialog can say it.
 */
export function printedSource(
  source: string,
  footnotes: boolean,
  copy: () => unknown
): { text: string; unavailable: boolean } {
  if (!footnotes) return { text: source, unavailable: false };
  let raw: unknown;
  try {
    raw = copy();
  } catch {
    // Pythia's failure is reported as a missing footnote, not a failed print.
    return { text: source, unavailable: true };
  }
  const checked = checkExportCopy(raw, source);
  return checked === null
    ? { text: source, unavailable: true }
    : { text: checked, unavailable: false };
}
