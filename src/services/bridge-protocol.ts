/**
 * What every bridge capability shares: the URL, the credential, and what to say
 * when a request comes back wrong.
 */

export type UrlResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Validate and canonicalise a configured bridge URL.
 *
 * Plain `http://` is rejected for anything but loopback: the request carries
 * the bridge token and the content of notes, so over a hosted deployment it
 * must be TLS. Loopback stays allowed so the bridge can be run locally while
 * testing.
 */
export function normalizeBaseUrl(raw: string): UrlResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, message: "no bridge URL configured — open Settings to add one." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: `bridge URL is not a valid URL: ${trimmed}` };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, message: "bridge URL must start with https://" };
  }

  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    return {
      ok: false,
      message: "bridge URL must use https:// — plain http is only allowed for localhost."
    };
  }

  const url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  return { ok: true, url };
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function buildEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };
}

/**
 * Turn a bridge failure into something a user can act on.
 *
 * The bridge sends `{ error, code, requestId }`, but a proxy in front of it may
 * not, so the raw body is used as a fallback. `upstream` names whatever the
 * bridge was talking to, since that is the part of a 502 the user can check.
 */
export function describeBridgeError(status: number, body: string, upstream: string): string {
  const detail = extractError(body);

  switch (status) {
    case 401:
      return "bridge rejected the token — check the token setting.";
    case 404:
      return detail || "bridge endpoint not found — check the Bridge URL setting.";
    case 409:
      return detail || "the bridge is busy with another publish.";
    case 413:
      return detail || "too large for the bridge to accept.";
    case 429:
      return "bridge is refusing further attempts after repeated token failures — wait a minute.";
    case 503:
      return "bridge is restarting — try again in a moment.";
    case 504:
      return `bridge timed out — ${detail || `${upstream} did not answer in time.`}`;
    case 502:
      return `${upstream} error — ${detail || `the bridge could not reach ${upstream}.`}`;
    default:
      return detail ? `bridge returned ${status} — ${detail}` : `bridge returned ${status}.`;
  }
}

/**
 * A failure the bridge answered, carrying the answer and not only its wording.
 *
 * Whether to try again used to be read out of the message, which names no
 * status for most answers: a dropped SFTP connection came back as "the web
 * host error — SFTP failed." and was given up on at once.
 */
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

/** The bridge's stable error code, or "" when the body is not the bridge's. */
export function extractCode(body: string): string {
  return str(asRecord(jsonOrNull(body)).code);
}

export function extractError(body: string): string {
  return str(asRecord(jsonOrNull(body)).error) || body.trim().slice(0, 200);
}

function jsonOrNull(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

/** How much of a body that is not JSON is worth quoting: enough to recognise a login page. */
const MAX_QUOTED_BODY_CHARS = 120;

/**
 * The body of a successful answer as JSON, or an error that says what came
 * instead.
 *
 * The platform parses a body lazily and throws a bare syntax error when a
 * proxy, a captive portal or a misconfigured host answered a page with a 200;
 * the status and the start of the body are what let the person tell which.
 */
export function parseJsonBody(response: { status: number; text: string }): unknown {
  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    const quoted = response.text.trim().slice(0, MAX_QUOTED_BODY_CHARS) || "(empty body)";
    throw new Error(`answer ${response.status} is not JSON: ${quoted}`);
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
