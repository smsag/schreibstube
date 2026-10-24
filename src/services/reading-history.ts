/**
 * The reading history in a note: the list it keeps, when it was last checked,
 * and how a check adds to it.
 *
 * The note holds nothing a reader cannot see. The frontmatter says when the
 * account was last asked, where Obsidian's properties show it and a Base can
 * sort by it. The list is nothing but its entries — a link, the day it came,
 * the highlights — and an entry is known by that shape and by its link, with
 * no marker around the list and no id after a line. A link is a looser key
 * than an id: an article saved twice under two addresses is listed twice, and
 * that is the price of a note without comments in it.
 *
 * New entries go above the first entry the note holds, or at its end when it
 * holds none, so the person decides where the list lives by moving it. Entries
 * are only ever added or, for the highlight count and a missing summary,
 * completed; a line a person rewrote so that it no longer reads as an entry is
 * left exactly as it is.
 */
import { t } from "../i18n";
import { escapeForeignText } from "./foreign-text";
import {
  inSection,
  MAX_TITLE_CHARS,
  type Bookmark,
  type ReadingSection
} from "./instapaper-request";
import { formatUpdatedAt } from "./sync-frontmatter";
import { isNoteDue, type SyncSchedule } from "./sync-interval";

/** When the note's list was last checked: a date-time property, local time. */
export const READING_CHECKED_KEY = "schreibstubeReadingCheckedAt";

/** How often a note that does not say is checked. */
export const DEFAULT_READING_EVERY_MINUTES = 6 * 60;

/**
 * How far back a check asks beyond the last one.
 *
 * The check time is written as Obsidian writes a date-time property, in the
 * writing device's local time and without its offset, so a phone in another
 * time zone reads it as hours earlier or later than it was. A day covers every
 * zone there is; the links keep what is asked twice from being listed twice.
 */
export const SINCE_OVERLAP_SECONDS = 24 * 60 * 60;

/** Entries whose counts are looked at again per check. */
export const MAX_REFRESH_PER_CHECK = 50;

/**
 * The newest articles of the list, read on every check besides what changed.
 *
 * Whether a new highlight marks its bookmark as changed is not something the
 * API promises, and most highlighting happens in the days after an article is
 * archived, when it is still near the top. The note keeps no ids, so this page
 * is also what names the newest entries' bookmarks for their highlights.
 */
export const RECENT_REFRESH_COUNT = 10;

/** A link, then the day it came: the shape that makes a line an entry. */
const ENTRY = /^- \[(?:\\.|[^\]\\])*\]\(([^()\s]+)\) · \d{4}-\d{2}-\d{2}\b/;
const COUNT = / · (\d+) [^·%]+?(?= %%instapaper:\d+%%$|$)/;
/** What 1.88.0 wrote around the list and after each entry, removed on the next check. */
const LEGACY_MARKER = /^%% \/?schreibstube-reading(?: checked=(\d+))? %%$/;
const LEGACY_ID = / %%instapaper:\d+%%$/;
const SUMMARY = /^ {2}> /;

export interface ReadingEntry {
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

export interface ReadingList {
  /** Entries by their link, in the note's order. */
  entries: Map<string, ListedEntry>;
  /** The check time a 1.88.0 note kept in its list's marker, for one not yet moved over. */
  legacyChecked: number | null;
}

/** The entries a note holds, wherever in its body they stand. */
export function readReadingList(text: string): ReadingList {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const entries = new Map<string, ListedEntry>();
  let legacyChecked: number | null = null;

  for (let index = bodyStart(lines); index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const legacy = LEGACY_MARKER.exec(line)?.[1];
    if (legacy !== undefined) legacyChecked = Number(legacy);

    const url = ENTRY.exec(line)?.[1];
    if (url === undefined || entries.has(url)) continue;
    entries.set(url, {
      highlights: Number(COUNT.exec(line)?.[1] ?? 0),
      hasSummary: SUMMARY.test(lines[index + 1] ?? "")
    });
  }

  return { entries, legacyChecked };
}

/**
 * When the note was last checked, in Unix seconds, or null when it never was.
 *
 * Read as the local time Obsidian writes; a value that is not a date is no
 * check time, and the note starts over rather than asking from a guess.
 */
export function readCheckedAt(value: unknown, list: ReadingList): number | null {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (match) {
      // A time typed without seconds is a time; its seconds are not missing, they are zero.
      const [y, mo, d, h, mi, s] = match
        .slice(1)
        .map((part: string | undefined) => Number(part ?? 0));
      const date = new Date(y ?? 0, (mo ?? 1) - 1, d, h, mi, s);
      if (!Number.isNaN(date.getTime())) return Math.floor(date.getTime() / 1000);
    }
  }
  return list.legacyChecked;
}

/** The check time as the property holds it. */
export function formatCheckedAt(seconds: number): string {
  return formatUpdatedAt(new Date(seconds * 1000));
}

/** Whether a note is due, by its own `schreibstubeSyncEvery` or the default. */
export function isReadingDue(
  checkedAt: number | null,
  schedule: SyncSchedule | null,
  now: Date
): boolean {
  if (checkedAt === null) return true;
  const effective: SyncSchedule = schedule ?? {
    kind: "every",
    minutes: DEFAULT_READING_EVERY_MINUTES,
    cron: null,
    text: ""
  };
  return isNoteDue(effective, checkedAt * 1000, now);
}

/** The `since` to ask with, or null for a first check. */
export function sinceFor(checkedAt: number | null): number | null {
  return checkedAt === null ? null : Math.max(1, checkedAt - SINCE_OVERLAP_SECONDS);
}

export interface Selection {
  /** Bookmarks to list, in the order the answers gave them. */
  added: Bookmark[];
  /** Bookmarks already listed, for their highlight counts. */
  refreshed: Bookmark[];
}

/**
 * Which bookmarks a check writes.
 *
 * A first check asked for the section itself, so everything in the answer
 * belongs. Later checks asked what changed across the whole account, and only
 * a bookmark now in the section counts. One already listed — by its link — may
 * have gained highlights; one whose link appears twice is taken once.
 */
export function selectBookmarks(input: {
  bookmarks: readonly Bookmark[];
  section: ReadingSection;
  list: ReadingList;
  firstRun: boolean;
}): Selection {
  const known = input.list.entries;
  const seen = new Set<string>();
  const added: Bookmark[] = [];
  const refreshed: Bookmark[] = [];

  for (const bookmark of input.bookmarks) {
    const url = entryUrl(bookmark.url);
    if (seen.has(url)) continue;
    seen.add(url);
    if (!input.firstRun && !inSection(bookmark, input.section)) continue;

    if (!known.has(url)) {
      added.push(bookmark);
    } else if (refreshed.length < MAX_REFRESH_PER_CHECK) {
      refreshed.push(bookmark);
    }
  }

  return { added, refreshed };
}

/** The bookmarks whose highlights a check reads: every new and every known one. */
export function highlightsToFetch(selection: Selection): number[] {
  return [...selection.added, ...selection.refreshed].map((bookmark) => bookmark.id);
}

/**
 * Which bookmarks get a summary on this check, in order: new entries first,
 * then listed ones that have none yet — and only those with highlights to
 * summarize.
 */
export function planSummaries(input: {
  selection: Selection;
  list: ReadingList;
  highlightCounts: ReadonlyMap<number, number>;
  max: number;
}): number[] {
  const hasSummary = (bookmark: Bookmark): boolean =>
    input.list.entries.get(entryUrl(bookmark.url))?.hasSummary ?? false;
  return [
    ...input.selection.added,
    ...input.selection.refreshed.filter((bookmark) => !hasSummary(bookmark))
  ]
    .map((bookmark) => bookmark.id)
    .filter((id) => (input.highlightCounts.get(id) ?? 0) > 0)
    .slice(0, input.max);
}

export interface EntryChange {
  url: string;
  highlights?: number;
  summary?: string;
}

export interface ReadingUpdate {
  /** New entries, newest first; they go to the top of the list. */
  added: readonly ReadingEntry[];
  changed: readonly EntryChange[];
}

/** The update a check writes, from what it found. */
export function buildReadingUpdate(input: {
  now: Date;
  selection: Selection;
  highlightCounts: ReadonlyMap<number, number>;
  summaries: ReadonlyMap<number, string>;
}): ReadingUpdate {
  const date = entryDate(input.now);
  const added = input.selection.added.map((bookmark) => ({
    title: bookmark.title,
    url: bookmark.url,
    date,
    highlights: input.highlightCounts.get(bookmark.id) ?? 0,
    summary: input.summaries.get(bookmark.id) ?? null
  }));
  const changed = input.selection.refreshed.map((bookmark): EntryChange => {
    const summary = input.summaries.get(bookmark.id);
    return {
      url: entryUrl(bookmark.url),
      highlights: input.highlightCounts.get(bookmark.id) ?? 0,
      ...(summary === undefined ? {} : { summary })
    };
  });
  return { added, changed };
}

export interface TextEdit {
  from: number;
  to: number;
  text: string;
}

/**
 * The note as a check leaves it: the list brought up to date and the check
 * time set in the frontmatter.
 *
 * Computed from the text as it stands at the moment of writing, not as it was
 * when the check began: the person may have typed in the meantime, and a note
 * planned against the older text would put their words back.
 */
export function applyReadingCheck(text: string, update: ReadingUpdate, checkedAt: number): string {
  const listed = applyReadingList(text, update);
  return setFrontmatterValue(listed, READING_CHECKED_KEY, formatCheckedAt(checkedAt)) ?? listed;
}

/**
 * The note with its list brought up to date: new entries above the first one,
 * counts and owed summaries completed, and anything 1.88.0 hid in it removed.
 */
export function applyReadingList(text: string, update: ReadingUpdate): string {
  const lines = text.split("\n");
  const start = bodyStart(lines.map((line) => line.replace(/\r$/, "")));
  const changes = new Map(update.changed.map((change) => [change.url, change]));
  const out: string[] = [];
  let firstEntry = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const cr = raw.endsWith("\r") ? "\r" : "";
    const line = cr ? raw.slice(0, -1) : raw;
    if (index >= start && LEGACY_MARKER.test(line)) continue;

    const url = index >= start ? ENTRY.exec(line)?.[1] : undefined;
    if (url === undefined) {
      out.push(raw);
      continue;
    }
    if (firstEntry === -1) firstEntry = out.length;

    const plain = line.replace(LEGACY_ID, "");
    const change = changes.get(url);
    if (change === undefined) {
      out.push(plain + cr);
      continue;
    }
    // Once is enough: a link listed twice by hand is completed where it is first.
    changes.delete(url);

    out.push((change.highlights === undefined ? plain : withCount(plain, change.highlights)) + cr);
    const hasSummary = SUMMARY.test(lines[index + 1] ?? "");
    if (!hasSummary && change.summary !== undefined && change.summary.length > 0) {
      out.push(summaryLine(change.summary) + cr);
    }
  }

  const fresh = update.added.flatMap(renderEntry);
  if (fresh.length === 0) return out.join("\n");
  if (firstEntry !== -1) {
    out.splice(firstEntry, 0, ...fresh);
    return out.join("\n");
  }

  const body = out.join("\n");
  const separator =
    body.length === 0 ? "" : body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${separator}${fresh.join("\n")}\n`;
}

/**
 * The note with one frontmatter key set to a plain value, or null when it
 * cannot be said in one line — the key holds a list or a folded block there.
 *
 * A note without frontmatter is given some. Read and written as lines, not
 * YAML: the value is a date-time this module wrote, and everything else in the
 * block stays exactly as it was.
 */
export function setFrontmatterValue(text: string, key: string, value: string): string | null {
  const lines = text.split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") return `---\n${key}: ${value}\n---\n${text}`;

  const close = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/, "") === "---");
  if (close === -1) return null;

  // The line written ends as the note's lines do. Ended with a "\n" alone, it
  // left a note of Windows line ends with two kinds of line, one of them
  // written by nobody who opened the note.
  const entry = `${key}: ${value}${lines[0].endsWith("\r") ? "\r" : ""}`;
  const at = lines.findIndex(
    (line, index) =>
      index > 0 && index < close && line.startsWith(key) && /^\s*:/.test(line.slice(key.length))
  );
  if (at === -1) {
    lines.splice(close, 0, entry);
    return lines.join("\n");
  }

  const next = lines[at + 1];
  if (at + 1 < close && next !== undefined && /^\s/.test(next)) return null;
  lines[at] = entry;
  return lines.join("\n");
}

/** The one change that turns `before` into `after`, for writing through an editor. */
export function diffEdit(before: string, after: string): TextEdit {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before[start] === after[start]) start += 1;

  let end = 0;
  while (end < limit - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
    end += 1;
  }

  return { from: start, to: before.length - end, text: after.slice(start, after.length - end) };
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

/** Apply an edit to text. */
export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.text + text.slice(edit.to);
}

/** One entry as lines of the note. */
export function renderEntry(entry: ReadingEntry): string[] {
  const parts = [`- [${entryTitle(entry.title)}](${entryUrl(entry.url)})`, entry.date];
  if (entry.highlights > 0) parts.push(t().reading.highlights(entry.highlights));
  const line = parts.join(" · ");
  return entry.summary === null || entry.summary.length === 0
    ? [line]
    : [line, summaryLine(entry.summary)];
}

function summaryLine(summary: string): string {
  return `  > ${summary}`;
}

function withCount(line: string, highlights: number): string {
  const segment = highlights > 0 ? ` · ${t().reading.highlights(highlights)}` : "";
  return COUNT.test(line) ? line.replace(COUNT, segment) : `${line}${segment}`;
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

/**
 * A link as the entry writes it, which is also how an entry is recognized:
 * one spelling per address, and none that can end the link or the line early.
 */
export function entryUrl(raw: string): string {
  return new URL(raw).href.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

/** Local `YYYY-MM-DD`: the day the person saw the entry arrive. */
export function entryDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/** The first line after the frontmatter, so a list in the properties is no list of entries. */
function bodyStart(lines: readonly string[]): number {
  if (lines[0] !== "---") return 0;
  const close = lines.findIndex((line, index) => index > 0 && line === "---");
  return close === -1 ? 0 : close + 1;
}
