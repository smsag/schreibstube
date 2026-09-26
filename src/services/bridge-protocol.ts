/**
 * What every bridge capability shares: the URL, the credential, and what to say
 * when a request comes back wrong.
 *
 * Kept free of `obsidian` imports so it stays unit-testable — the same split as
 * `llm-providers.ts` (pure) and `llm-client.ts` (transport).
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

  // Strip trailing slashes so endpoint joining never produces a double slash.
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
  try {
    return str(asRecord(JSON.parse(body) as unknown).code);
  } catch {
    return "";
  }
}

export function extractError(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const message = str(asRecord(parsed).error);
    if (message) {
      return message;
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return body.trim().slice(0, 200);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
