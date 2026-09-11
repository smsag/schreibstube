/**
 * Fetches a bound note's source.
 *
 * Conditional requests carry the validator from the last fetch, so an unchanged
 * document costs one small round trip and no body at all. That keeps the
 * on-open check cheap enough to run every time a mirror is opened, and keeps
 * unauthenticated rate limits comfortable.
 */

import { requestUrl } from "obsidian";

/** A document larger than this is refused rather than pasted into a note. */
export const MAX_SOURCE_BYTES = 1_000_000;

const REQUEST_TIMEOUT_MS = 20_000;

const MARKDOWN_CONTENT_TYPES = ["text/markdown", "text/plain", "text/x-markdown", "application/octet-stream"];

export type FetchOutcome =
  | { status: "updated"; body: string; etag: string }
  | { status: "unchanged"; etag: string }
  /** The source is gone. The note is never emptied in response. */
  | { status: "missing"; message: string }
  | { status: "error"; message: string };

export interface FetchOptions {
  url: string;
  /** Validator from the previous fetch, or empty on the first one. */
  etag?: string;
}

export async function fetchSource(options: FetchOptions): Promise<FetchOutcome> {
  const headers: Record<string, string> = { accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" };
  if (options.etag) {
    headers["If-None-Match"] = options.etag;
  }

  let response: Awaited<ReturnType<typeof requestUrl>>;
  try {
    response = await withTimeout(
      requestUrl({ url: options.url, method: "GET", headers, throw: false }),
      REQUEST_TIMEOUT_MS
    );
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Netzwerkfehler." };
  }

  if (response.status === 304) {
    return { status: "unchanged", etag: options.etag ?? "" };
  }

  if (response.status === 404 || response.status === 410) {
    return { status: "missing", message: `Quelle nicht gefunden (HTTP ${response.status}).` };
  }

  if (response.status < 200 || response.status >= 300) {
    return { status: "error", message: `Quelle antwortete mit HTTP ${response.status}.` };
  }

  const contentType = header(response.headers, "content-type");
  if (contentType && !isMarkdownType(contentType)) {
    return {
      status: "error",
      message: `Quelle ist kein Markdown (${contentType.split(";")[0]}).`,
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

function isMarkdownType(contentType: string): boolean {
  const base = contentType.split(";")[0].trim().toLowerCase();
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
