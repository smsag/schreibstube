/**
 * Fetches a bound note's source.
 *
 * Conditional requests carry the validator from the last fetch, so an unchanged
 * document costs one small round trip and no body at all. That keeps the
 * on-open check cheap enough to run every time a mirror is opened, and keeps
 * unauthenticated rate limits comfortable.
 */

import { requestUrl } from "obsidian";
import { githubApiUrl, type SourceTarget } from "./sync-source";

/** A document larger than this is refused rather than pasted into a note. */
export const MAX_SOURCE_BYTES = 1_000_000;

const REQUEST_TIMEOUT_MS = 20_000;

const MARKDOWN_CONTENT_TYPES = [
  "text/markdown",
  "text/plain",
  "text/x-markdown",
  "application/octet-stream"
];

export type FetchOutcome =
  | { status: "updated"; body: string; etag: string }
  | { status: "unchanged"; etag: string }
  /** The source is gone. The note is never emptied in response. */
  | { status: "missing"; message: string }
  | { status: "error"; message: string };

export interface FetchOptions {
  url: string;
  target: SourceTarget;
  /** Validator from the previous fetch, or empty on the first one. */
  etag?: string | undefined;
  /** A GitHub token from secret storage. Only ever sent to GitHub. */
  token?: string | undefined;
}

/**
 * Fetch a source, using the GitHub contents API when a token is available.
 *
 * A private repository is read through the contents API, asking for the raw
 * representation. That is a routing decision, not a limitation: the file is
 * perfectly readable, just not from `raw.githubusercontent.com`, which ignores
 * an Authorization header and answers 404 for anything private. So a GitHub
 * source is redirected to the API whenever a token is available, and the same
 * request serves public repositories too.
 *
 * The token is also why the target matters at all. Every non-GitHub host is
 * fetched plainly and never sees the credential, whatever the URL in the note
 * claims to be.
 */
export async function fetchSource(options: FetchOptions): Promise<FetchOutcome> {
  const authenticated = Boolean(options.token) && options.target.kind === "github";

  const url = authenticated
    ? githubApiUrl(options.target as Extract<SourceTarget, { kind: "github" }>)
    : options.url;

  const headers: Record<string, string> = {
    accept: authenticated
      ? "application/vnd.github.raw"
      : "text/markdown, text/plain;q=0.9, */*;q=0.1"
  };

  if (authenticated) {
    headers.Authorization = `Bearer ${options.token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  if (options.etag) {
    headers["If-None-Match"] = options.etag;
  }

  let response: Awaited<ReturnType<typeof requestUrl>>;
  try {
    response = await withTimeout(
      requestUrl({ url, method: "GET", headers, throw: false }),
      REQUEST_TIMEOUT_MS
    );
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Netzwerkfehler." };
  }

  if (response.status === 304) {
    return { status: "unchanged", etag: options.etag ?? "" };
  }

  if (response.status === 404 || response.status === 410) {
    // GitHub answers 404 for a private repository the token cannot see, which
    // is indistinguishable from a deleted file. Saying so beats reporting a
    // file as gone when the real problem is the credential.
    const hint =
      options.target.kind === "github" && !authenticated
        ? " Für ein privates Repository wird ein GitHub-Token benötigt."
        : "";
    return {
      status: "missing",
      message: `Quelle nicht gefunden (HTTP ${response.status}).${hint}`
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: "error",
      message: rateLimited(response.headers)
        ? "GitHub-Ratenlimit erreicht. Ein Token erhöht das Limit deutlich."
        : `Zugriff verweigert (HTTP ${response.status}). Token prüfen.`
    };
  }

  if (response.status < 200 || response.status >= 300) {
    return { status: "error", message: `Quelle antwortete mit HTTP ${response.status}.` };
  }

  const contentType = header(response.headers, "content-type");

  if (authenticated) {
    // The contents API answers with the file body only when it honours the raw
    // media type. If it fell back to its JSON representation, that JSON must
    // never be written into a note as if it were the document.
    if (contentType && contentType.split(";")[0]?.trim().toLowerCase() === "application/json") {
      return { status: "error", message: "GitHub lieferte Metadaten statt Dateiinhalt." };
    }
  } else if (contentType && !isMarkdownType(contentType)) {
    return {
      status: "error",
      message: `Quelle ist kein Markdown (${contentType.split(";")[0]}).`
    };
  }

  const body = response.text ?? "";
  if (body.length > MAX_SOURCE_BYTES) {
    return { status: "error", message: "Quelle überschreitet die Größengrenze." };
  }

  return { status: "updated", body, etag: header(response.headers, "etag") ?? "" };
}

/** Header names arrive in whatever case the server used. */
function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return match ? headers[match] : undefined;
}

/** A zero remaining-quota header is the honest explanation for a 403. */
function rateLimited(headers: Record<string, string> | undefined): boolean {
  return header(headers, "x-ratelimit-remaining") === "0";
}

function isMarkdownType(contentType: string): boolean {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return MARKDOWN_CONTENT_TYPES.includes(base);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error(`Quelle antwortete nicht innerhalb von ${Math.round(ms / 1000)}s.`)),
      ms
    );
  });
  return Promise.race([promise.finally(() => window.clearTimeout(timer)), timeout]);
}
