/**
 * The reading history block in a note: what it holds, and how a check adds to it.
 *
 * The block is the whole of the state. It says when the account was last asked
 * and which bookmarks are already listed, so the note carries its own
 * bookkeeping to every device the vault syncs to, and nothing in the plugin's
 * data file can disagree with it. Deleting the block starts the history over.
 *
 * Entries are only ever added or, for the highlight count and a missing
 * summary, completed. A line a person rewrote so that it no longer reads as an
 * entry is left exactly as it is: the history is theirs to edit, and a check
 * that "repaired" it would be undoing that on a timer.
 */
import { t } from "../i18n";
import { escapeForeignText } from "./foreign-text";
import {
  inSection,
  MAX_TITLE_CHARS,
  type Bookmark,
  type ReadingSection
} from "./instapaper-request";
import { isNoteDue, type SyncSchedule } from "./sync-interval";

/** How often a note that does not say is checked. */
export const DEFAULT_READING_EVERY_MINUTES = 6 * 60;

/** Asked again with this much overlap, so a bookmark changed while the last
 *  answer was on its way is not missed; the ids keep it from being listed twice. */
export const SINCE_OVERLAP_SECONDS = 5 * 60;

/** Entries whose counts are looked at again per check. */
export const MAX_REFRESH_PER_CHECK = 50;

/**
 * The newest entries, whose highlights are read again on every check.
 *
 * Whether a new highlight marks its bookmark as changed is not something the
 * API promises, and most highlighting happens in the days after an article is
 * archived, when it is still near the top of the list. Ten requests a check is
 * the price of not depending on it.
 */
export const RECENT_REFRESH_COUNT = 10;

const START = /^%% schreibstube-reading checked=(\d+) %%$/;
const END = "%% /schreibstube-reading %%";
const ENTRY = /^- .* %%instapaper:(\d+)%%$/;
const COUNT = / · (\d+) [^·]+(?= %%instapaper:\d+%%$)/;
const SUMMARY = /^ {2}> /;

export interface ReadingEntry {
  id: number;
  title: string;
  url: string;
  /** `YYYY-MM-DD`, the day the entry was written. */
  date: string;
  highlights: number;
  summary: string | null;
}

export interface ListedEntry {
  highlights: number;
  hasSummary: boolean;
}

export interface ReadingBlock {
  /** Unix seconds of the last check. */
  checked: number;
  entries: Map<number, ListedEntry>;
  /** Offsets of the block in the note, end marker included. */
  from: number;
  to: number;
}

/** The note's block, or null when it has none — a note never checked yet. */
export function readReadingBlock(text: string): ReadingBlock | null {
  const lines = splitLines(text);
  const start = lines.findIndex((line) => START.test(line.text));
  if (start === -1) return null;

  const end = lines.findIndex((line, index) => index > start && line.text === END);
  if (end === -1) return null;

  const startLine = lines[start];
  const endLine = lines[end];
  if (startLine === undefined || endLine === undefined) return null;

  const entries = new Map<number, ListedEntry>();
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index]?.text ?? "";
    const id = Number(ENTRY.exec(line)?.[1]);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    entries.set(id, {
      highlights: Number(COUNT.exec(line)?.[1] ?? 0),
      hasSummary: SUMMARY.test(lines[index + 1]?.text ?? "")
    });
  }

  return {
    checked: Number(START.exec(startLine.text)?.[1]),
    entries,
    from: startLine.from,
    to: endLine.to
  };
}

/** Whether a note is due, by its own `schreibstubeSyncEvery` or the default. */
export function isReadingDue(
  block: ReadingBlock | null,
  schedule: SyncSchedule | null,
  now: Date
): boolean {
  if (block === null) return true;
  const effective: SyncSchedule = schedule ?? {
    kind: "every",
    minutes: DEFAULT_READING_EVERY_MINUTES,
    cron: null,
    text: ""
  };
  return isNoteDue(effective, block.checked * 1000, now);
}

/** The `since` to ask with, or null for a first check. */
export function sinceFor(block: ReadingBlock | null): number | null {
  return block === null ? null : Math.max(1, block.checked - SINCE_OVERLAP_SECONDS);
}

export interface Selection {
  /** Bookmarks to list, in the order the answer gave them. */
  added: Bookmark[];
  /** Bookmarks already listed that changed, for their highlight counts. */
  refreshed: Bookmark[];
}

/**
 * Which bookmarks a check writes.
 *
 * A first check asked for the section itself, so everything in the answer
 * belongs. Later checks asked what changed across the whole account, and only
 * a bookmark now in the section counts; one that changed and is already
 * listed may have gained highlights.
 */
export function selectBookmarks(input: {
  bookmarks: readonly Bookmark[];
  section: ReadingSection;
  block: ReadingBlock | null;
}): Selection {
  const known = input.block?.entries ?? new Map<number, ListedEntry>();
  const firstRun = input.block === null;
  const seen = new Set<number>();
  const added: Bookmark[] = [];
  const refreshed: Bookmark[] = [];

  for (const bookmark of input.bookmarks) {
    if (seen.has(bookmark.id)) continue;
    seen.add(bookmark.id);
    if (!firstRun && !inSection(bookmark, input.section)) continue;

    if (!known.has(bookmark.id)) {
      added.push(bookmark);
    } else if (refreshed.length < MAX_REFRESH_PER_CHECK) {
      refreshed.push(bookmark);
    }
  }

  return { added, refreshed };
}

export interface EntryChange {
  id: number;
  highlights?: number;
  summary?: string;
}

export interface ReadingUpdate {
  /** Unix seconds this check started. */
  checked: number;
  /** New entries, newest first; they go to the top of the list. */
  added: readonly ReadingEntry[];
  changed: readonly EntryChange[];
}

export interface TextEdit {
  from: number;
  to: number;
  text: string;
}

/**
 * The edit that brings a note's block up to date.
 *
 * Computed from the text as it stands at the moment of writing, not as it was
 * when the check began: the person may have typed in the meantime, and an
 * edit planned against the older text would put their words back.
 */
export function planReadingEdit(text: string, update: ReadingUpdate): TextEdit {
  const block = readReadingBlock(text);
  const start = `%% schreibstube-reading checked=${String(Math.floor(update.checked))} %%`;
  const fresh = update.added.flatMap(renderEntry);

  if (block === null) {
    const separator =
      text.length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return {
      from: text.length,
      to: text.length,
      text: `${separator}${[start, ...fresh, END].join("\n")}\n`
    };
  }

  const changes = new Map(update.changed.map((change) => [change.id, change]));
  const inner = text
    .slice(block.from, block.to)
    .split("\n")
    .slice(1, -1)
    .map((line) => line.replace(/\r$/, ""));
  const kept: string[] = [];

  for (let index = 0; index < inner.length; index += 1) {
    const line = inner[index] ?? "";
    const id = Number(ENTRY.exec(line)?.[1]);
    const change = changes.get(id);
    if (change === undefined) {
      kept.push(line);
      continue;
    }

    kept.push(change.highlights === undefined ? line : withCount(line, change.highlights));
    const hasSummary = SUMMARY.test(inner[index + 1] ?? "");
    if (!hasSummary && change.summary !== undefined && change.summary.length > 0) {
      kept.push(summaryLine(change.summary));
    }
  }

  return { from: block.from, to: block.to, text: [start, ...fresh, ...kept, END].join("\n") };
}

/** What a check needs fetched beyond the list itself. */
export interface HighlightWork {
  /** Bookmarks whose highlights are read: new, changed, recent, and summaries owed. */
  fetch: number[];
  /** The newest listed entries, read again whether or not they changed. */
  recent: number[];
  /** Listed entries with highlights and no summary yet, finished on this check. */
  backfill: number[];
}

/**
 * Which highlights a check reads.
 *
 * Every new entry needs its count, every changed one may have gained some, the
 * newest are read again in case they did without saying so, and with
 * summaries on, an entry left without one by an earlier check — the per-check
 * limit, a provider that failed — is finished now.
 */
export function planHighlightWork(input: {
  selection: Selection;
  block: ReadingBlock | null;
  summaries: boolean;
  maxSummaries: number;
}): HighlightWork {
  const touched = new Set(
    [...input.selection.added, ...input.selection.refreshed].map((b) => b.id)
  );
  const listed = [...(input.block?.entries ?? new Map<number, ListedEntry>())];
  const recent = listed
    .slice(0, RECENT_REFRESH_COUNT)
    .map(([id]) => id)
    .filter((id) => !touched.has(id));
  const backfill = input.summaries
    ? listed
        .filter(
          ([id, entry]) =>
            entry.highlights > 0 && !entry.hasSummary && !touched.has(id) && !recent.includes(id)
        )
        .slice(0, input.maxSummaries)
        .map(([id]) => id)
    : [];
  return { fetch: [...touched, ...recent, ...backfill], recent, backfill };
}

/**
 * Which entries get a summary on this check, in order: new entries first,
 * then changed and recent ones that have none, then the backfill — and only
 * those with highlights to summarize.
 */
export function planSummaries(input: {
  selection: Selection;
  work: HighlightWork;
  block: ReadingBlock | null;
  highlightCounts: ReadonlyMap<number, number>;
  max: number;
}): number[] {
  const hasSummary = (id: number): boolean => input.block?.entries.get(id)?.hasSummary ?? false;
  const owed = [
    ...input.selection.added.map((b) => b.id),
    ...[...input.selection.refreshed.map((b) => b.id), ...input.work.recent].filter(
      (id) => !hasSummary(id)
    ),
    ...input.work.backfill
  ];
  return owed.filter((id) => (input.highlightCounts.get(id) ?? 0) > 0).slice(0, input.max);
}

/** The update a check writes, from what it found. */
export function buildReadingUpdate(input: {
  checked: number;
  now: Date;
  selection: Selection;
  work: HighlightWork;
  highlightCounts: ReadonlyMap<number, number>;
  summaries: ReadonlyMap<number, string>;
}): ReadingUpdate {
  const date = entryDate(input.now);
  const added = input.selection.added.map((bookmark) => ({
    id: bookmark.id,
    title: bookmark.title,
    url: bookmark.url,
    date,
    highlights: input.highlightCounts.get(bookmark.id) ?? 0,
    summary: input.summaries.get(bookmark.id) ?? null
  }));
  const changed = [
    ...input.selection.refreshed.map((b) => b.id),
    ...input.work.recent,
    ...input.work.backfill
  ].map((id): EntryChange => {
    const summary = input.summaries.get(id);
    return {
      id,
      highlights: input.highlightCounts.get(id) ?? 0,
      ...(summary === undefined ? {} : { summary })
    };
  });
  return { checked: input.checked, added, changed };
}

/** What a check across the reading notes amounted to. */
export interface ReadingCheckSummary {
  checked: number;
  added: number;
  failed: number;
  /** Why nothing was checked, when that was not the notes' doing. */
  skipped?: "disabled" | "busy" | "noToken";
  /** Why the first failed note failed. */
  reason?: string;
}

/** The sentence the notice shows for a check someone asked for. */
export function describeReadingCheck(summary: ReadingCheckSummary): string {
  const words = t().reading;
  if (summary.skipped === "disabled") return words.disabled;
  if (summary.skipped === "busy") return words.busy;
  if (summary.skipped === "noToken") return words.noToken;
  if (summary.checked === 0 && summary.failed === 0) return words.noneChecked;
  if (summary.checked === 0 && summary.reason !== undefined) return words.failed(summary.reason);
  return words.checked(summary.checked, summary.added, summary.failed);
}

/** Apply an edit to text, for a note that is not open in an editor. */
export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.text + text.slice(edit.to);
}

/** One entry as lines of the note. */
export function renderEntry(entry: ReadingEntry): string[] {
  const parts = [`- [${entryTitle(entry.title)}](${entryUrl(entry.url)})`, entry.date];
  if (entry.highlights > 0) parts.push(t().reading.highlights(entry.highlights));
  const line = `${parts.join(" · ")} %%instapaper:${String(entry.id)}%%`;
  return entry.summary === null || entry.summary.length === 0
    ? [line]
    : [line, summaryLine(entry.summary)];
}

function summaryLine(summary: string): string {
  return `  > ${summary}`;
}

function withCount(line: string, highlights: number): string {
  const segment = highlights > 0 ? ` · ${t().reading.highlights(highlights)}` : "";
  if (COUNT.test(line)) return line.replace(COUNT, segment);
  return line.replace(/ %%instapaper:(\d+)%%$/, `${segment} %%instapaper:$1%%`);
}

/**
 * A title as link text.
 *
 * The page chose it, so it is one line, bounded, and escaped like any text
 * from outside; the brackets are escaped as well, because a `]` would end the
 * link early and leave the rest of the title as Markdown.
 */
export function entryTitle(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  const cut =
    chars.length > MAX_TITLE_CHARS ? `${chars.slice(0, MAX_TITLE_CHARS - 1).join("")}…` : flat;
  return escapeForeignText(cut.replace(/[[\]\\]/g, "\\$&"));
}

/** A link target that cannot end the link or the line early. */
export function entryUrl(raw: string): string {
  return new URL(raw).href.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

/** Local `YYYY-MM-DD`: the day the person saw the entry arrive. */
export function entryDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

interface Line {
  text: string;
  from: number;
  to: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (const raw of text.split("\n")) {
    const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    lines.push({ text: body, from, to: from + body.length });
    from += raw.length + 1;
  }
  return lines;
}
