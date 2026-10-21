/**
 * What to ask Instapaper for, and what its answers mean.
 *
 * A reading note names a section of the account, never an address: the token
 * that opens the account goes to Instapaper's API and nowhere else, whatever a
 * note in a synced vault says. The answers are the account's own data, but
 * they still arrive from outside the process, so each one is size-checked and
 * read field by field rather than trusted as the shape the documentation shows.
 */
import { t } from "../i18n";
import { exceedsBytes } from "./response-size";

/** The only host the Instapaper token is ever sent to. */
export const INSTAPAPER_API = "https://www.instapaper.com/api/2/";

export const INSTAPAPER_TIMEOUT_MS = 20_000;

/** A page of 500 bookmarks with long titles is well under a megabyte; five is
 *  room for that and not for an answer that would take a phone's memory. */
export const MAX_LIST_BYTES = 5_000_000;
export const MAX_HIGHLIGHTS_BYTES = 1_000_000;

/** How much of the section a reading note starts with. */
export const FIRST_RUN_LIMIT = 100;
/** The API's own ceiling for one page. */
export const SINCE_PAGE_LIMIT = 500;
/** Pages read per check in sync mode. A day of changes is one page; a note left
 *  for months catches up over several checks rather than in one burst. */
export const MAX_SINCE_PAGES = 4;

export const MAX_TITLE_CHARS = 300;
export const MAX_URL_CHARS = 2000;

/** The frontmatter key that makes a note a reading history. */
export const READING_FROM_KEY = "schreibstubeReadingFrom";

/** The lists a reading note can follow. Folders and tags are not offered:
 *  their ids are the account's, and a note naming one breaks when it moves. */
export type ReadingSection = "archive" | "liked";

export type ReadingSourceResult =
  { ok: true; section: ReadingSection } | { ok: false; reason: string };

/**
 * What a note's `schreibstubeReadingFrom` says.
 *
 * Written by a person, so `instapaper:archive`, `Instapaper archive` and
 * `instapaper/archive` all read the same; anything else is refused with the
 * spelling that works.
 */
export function parseReadingSource(raw: unknown): ReadingSourceResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: t().reading.sourceMissing };
  }

  const match = /^instapaper\s*[:/\s]\s*(archive|liked)$/i.exec(raw.trim());
  const section = match?.[1]?.toLowerCase();
  if (section !== "archive" && section !== "liked") {
    return { ok: false, reason: t().reading.sourceUnknown };
  }
  return { ok: true, section };
}

export interface InstapaperRequest {
  url: string;
  headers: Record<string, string>;
}

export interface ListRequestInput {
  section: ReadingSection;
  /** Unix seconds of the last check, or null on the first one. */
  since: number | null;
  offset: number;
  token: string;
}

/**
 * The list request.
 *
 * The first check reads the section itself, newest first, as far back as the
 * first run reaches. Every later one asks what changed across the account
 * since the last: the API ignores the section in that mode, so the caller
 * keeps only what landed in it.
 */
export function planListRequest(input: ListRequestInput): InstapaperRequest {
  const params = new URLSearchParams();
  if (input.since === null) {
    params.set("section", input.section);
    params.set("limit", String(FIRST_RUN_LIMIT));
  } else {
    params.set("since", String(Math.max(1, Math.floor(input.since))));
    params.set("limit", String(SINCE_PAGE_LIMIT));
    if (input.offset > 0) params.set("offset", String(input.offset));
  }
  return { url: `${INSTAPAPER_API}bookmarks?${params.toString()}`, headers: headers(input.token) };
}

export function planHighlightsRequest(bookmarkId: number, token: string): InstapaperRequest {
  return {
    url: `${INSTAPAPER_API}bookmarks/${String(bookmarkId)}/highlights`,
    headers: headers(token)
  };
}

function headers(token: string): Record<string, string> {
  // A token pasted with a trailing newline is a header the platform refuses
  // to send, and the refusal names nothing.
  return { Authorization: `Bearer ${token.trim()}`, Accept: "application/json" };
}

export interface InstapaperResponse {
  status: number;
  headers: Record<string, string> | undefined;
  text: string | undefined;
}

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  archived: boolean;
  liked: boolean;
}

export type ListOutcome =
  { ok: true; bookmarks: Bookmark[]; total: number } | { ok: false; message: string };

export function interpretListResponse(response: InstapaperResponse): ListOutcome {
  const body = readBody(response, MAX_LIST_BYTES);
  if (!body.ok) return body;

  const record = asRecord(body.value);
  if (!Array.isArray(record.bookmarks)) {
    return { ok: false, message: t().reading.malformed };
  }

  const bookmarks = record.bookmarks.flatMap((entry) => {
    const bookmark = normalizeBookmark(entry);
    return bookmark === null ? [] : [bookmark];
  });
  const total =
    typeof record.total === "number" && Number.isSafeInteger(record.total) && record.total >= 0
      ? record.total
      : bookmarks.length;
  return { ok: true, bookmarks, total };
}

export interface Highlight {
  text: string;
  note: string;
}

export type HighlightsOutcome =
  { ok: true; highlights: Highlight[] } | { ok: false; message: string };

export function interpretHighlightsResponse(response: InstapaperResponse): HighlightsOutcome {
  const body = readBody(response, MAX_HIGHLIGHTS_BYTES);
  if (!body.ok) return body;

  const record = asRecord(body.value);
  if (!Array.isArray(record.highlights)) {
    return { ok: false, message: t().reading.malformed };
  }

  const highlights = record.highlights.flatMap((entry) => {
    const item = asRecord(entry);
    if (typeof item.text !== "string" || item.text.trim().length === 0) return [];
    return [{ text: item.text, note: typeof item.note === "string" ? item.note : "" }];
  });
  return { ok: true, highlights };
}

/** Whether a bookmark belongs in the section a note follows. */
export function inSection(bookmark: Bookmark, section: ReadingSection): boolean {
  return section === "archive" ? bookmark.archived : bookmark.liked;
}

/**
 * One bookmark, or null when it cannot become an entry.
 *
 * An id is what keeps an entry from being written twice, so a bookmark without
 * a usable one is dropped rather than guessed at. A link that is not http(s)
 * would be a `javascript:` or `obsidian:` URL of the page's choosing in a
 * note, and is dropped too.
 */
export function normalizeBookmark(value: unknown): Bookmark | null {
  const record = asRecord(value);
  const id = record.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;

  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (url.length === 0 || url.length > MAX_URL_CHARS || !isWebUrl(url)) return null;

  const title = typeof record.title === "string" ? record.title.trim() : "";
  return {
    id,
    url,
    title: title.length > 0 ? title : url,
    archived: record.archived === true,
    liked: record.liked === true
  };
}

function isWebUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

type BodyResult = { ok: true; value: unknown } | { ok: false; message: string };

function readBody(response: InstapaperResponse, maxBytes: number): BodyResult {
  const words = t().reading;
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: words.denied(response.status) };
  }
  if (response.status === 429) return { ok: false, message: words.rateLimited };
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, message: words.httpStatus(response.status) };
  }

  const text = response.text ?? "";
  if (exceedsBytes(response.headers, text, maxBytes)) {
    return { ok: false, message: words.tooLarge };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: words.malformed };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
