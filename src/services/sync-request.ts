/**
 * What to ask a source for, and what its answer means.
 *
 * The decisions of a fetch — which URL, which headers, whether a credential
 * goes along, and what each status and content type amounts to — live here
 * without the platform, so the private-repository path can be exercised on a
 * laptop against a recorded response rather than found out on a phone against
 * GitHub.
 */

import { t } from "../i18n";
import { githubApiUrl, type SourceTarget } from "./sync-source";

/** A document larger than this is refused rather than pasted into a note. */
export const MAX_SOURCE_BYTES = 1_000_000;

export const REQUEST_TIMEOUT_MS = 20_000;

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

export interface SourceRequest {
  url: string;
  headers: Record<string, string>;
  /** Whether the credential went along, which changes what a 404 means. */
  authenticated: boolean;
}

/** The parts of a response the interpretation depends on. */
export interface SourceResponse {
  status: number;
  headers: Record<string, string> | undefined;
  text: string | undefined;
}

/**
 * Plan the request, using the GitHub contents API when a token is available.
 *
 * A private repository is read through the contents API, asking for the raw
 * representation. That is a routing decision, not a limitation: the file is
 * perfectly readable, just not from `raw.githubusercontent.com` without a
 * credential. So a GitHub source is redirected to the API whenever a token is
 * available, and the same request serves public repositories too.
 *
 * The token is also why the target matters at all. Every non-GitHub host is
 * fetched plainly and never sees the credential, whatever the URL in the note
 * claims to be.
 */
export function planSourceRequest(options: FetchOptions): SourceRequest {
  // A token pasted with a trailing newline is not a different token; it is a
  // header value the platform refuses to send, and the refusal names nothing.
  const token = options.token?.trim() ?? "";
  const authenticated = token.length > 0 && options.target.kind === "github";

  const url = authenticated
    ? githubApiUrl(options.target as Extract<SourceTarget, { kind: "github" }>)
    : options.url;

  const headers: Record<string, string> = {
    // The media type the contents API documents for a file's body. Asked for
    // by name so the answer is the document and not its JSON description.
    accept: authenticated
      ? "application/vnd.github.raw+json"
      : "text/markdown, text/plain;q=0.9, */*;q=0.1"
  };

  if (authenticated) {
    headers.Authorization = `Bearer ${token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  if (options.etag) {
    headers["If-None-Match"] = options.etag;
  }

  return { url, headers, authenticated };
}

/** What a response amounts to, given the request that produced it. */
export function interpretSourceResponse(
  options: FetchOptions,
  request: SourceRequest,
  response: SourceResponse
): FetchOutcome {
  const messages = t().source;

  if (response.status === 304) {
    return { status: "unchanged", etag: options.etag ?? "" };
  }

  if (response.status === 404 || response.status === 410) {
    // GitHub answers 404 for a private repository the caller cannot see, which
    // is indistinguishable from a deleted file. That holds with a token as
    // well: a fine-grained token is granted repositories one by one, and one
    // that was not granted this repository is answered exactly like no token
    // at all. Saying so beats reporting a file as gone when the real problem
    // is the credential.
    const hint =
      options.target.kind !== "github"
        ? ""
        : request.authenticated
          ? ` ${messages.tokenNoAccess}`
          : ` ${messages.privateNeedsToken}`;
    return { status: "missing", message: `${messages.notFound(response.status)}${hint}` };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: "error",
      message: rateLimited(response.headers)
        ? messages.rateLimited
        : messages.denied(response.status)
    };
  }

  if (response.status < 200 || response.status >= 300) {
    return { status: "error", message: messages.httpStatus(response.status) };
  }

  const contentType = header(response.headers, "content-type");
  const base = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";

  if (request.authenticated) {
    // The contents API answers with the file body only when it honours the raw
    // media type. If it fell back to its JSON representation, that JSON must
    // never be written into a note as if it were the document.
    if (base === "application/json") {
      return { status: "error", message: messages.metadataNotFile };
    }
  } else if (contentType && !MARKDOWN_CONTENT_TYPES.includes(base)) {
    return { status: "error", message: messages.notMarkdownType(base) };
  }

  const body = response.text ?? "";
  if (body.length > MAX_SOURCE_BYTES) {
    return { status: "error", message: messages.tooLarge };
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
