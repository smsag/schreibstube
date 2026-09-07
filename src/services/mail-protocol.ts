/**
 * Pure request/response handling for the mail bridge.
 *
 * Kept free of `obsidian` imports so it stays unit-testable — the same split
 * as `llm-providers.ts` (pure) and `llm-client.ts` (transport). Everything the
 * bridge returns is remote JSON, so each field is validated rather than
 * trusted.
 */

/** How long to wait for a bridge response before giving up. IMAP searches over
 *  a large mailbox are slower than a typical API call, so this is generous. */
export const MAIL_REQUEST_TIMEOUT_MS = 45_000;

export interface MailBridgeConfig {
  baseUrl: string;
  token: string;
}

export interface MailMessage {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  to: string;
  subject: string;
  date: string | null;
  text: string;
  truncated: boolean;
}

export interface SearchCriteria {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  since?: string;
  /** Message-ID of a sent note; matches replies citing it in References or
   *  In-Reply-To. This is what turns a note into a thread anchor. */
  references?: string;
}

export interface SearchRequest {
  criteria: SearchCriteria;
  mailbox?: string;
  limit?: number;
}

export interface SearchResult {
  messages: MailMessage[];
  mailbox: string;
  truncated: boolean;
}

export interface SendRequest {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  from?: string;
  inReplyTo?: string;
  references?: string[];
}

export interface SendResult {
  messageId: string;
  sentAt: string;
  filedInSent: boolean;
}

export type UrlResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Validate and canonicalise the configured bridge URL.
 *
 * Plain `http://` is rejected for anything but loopback: the request carries
 * the bridge token and full message bodies, so over a hosted deployment it must
 * be TLS. Loopback stays allowed so the bridge can be run locally while testing.
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

/** True when at least one criterion is set. An empty search would return the
 *  whole mailbox, which is never what the user meant. */
export function hasCriteria(criteria: SearchCriteria): boolean {
  return Object.values(criteria).some((value) => (value ?? "").trim().length > 0);
}

export function parseSearchResult(json: unknown): SearchResult {
  const root = asRecord(json);
  const rawMessages = Array.isArray(root.messages) ? root.messages : [];
  return {
    messages: rawMessages.map(parseMessage),
    mailbox: str(root.mailbox) || "INBOX",
    truncated: root.truncated === true
  };
}

export function parseSendResult(json: unknown): SendResult {
  const root = asRecord(json);
  const messageId = str(root.messageId);
  if (!messageId) {
    throw new Error("the bridge did not return a Message-ID.");
  }
  return {
    messageId,
    sentAt: str(root.sentAt) || new Date().toISOString(),
    filedInSent: root.filedInSent === true
  };
}

function parseMessage(raw: unknown): MailMessage {
  const record = asRecord(raw);
  const references = Array.isArray(record.references)
    ? record.references.map(str).filter((value): value is string => value.length > 0)
    : [];

  return {
    uid: typeof record.uid === "number" ? record.uid : 0,
    messageId: str(record.messageId) || null,
    inReplyTo: str(record.inReplyTo) || null,
    references,
    from: str(record.from),
    to: str(record.to),
    subject: str(record.subject),
    date: str(record.date) || null,
    text: str(record.text),
    truncated: record.truncated === true
  };
}

/** Turn a bridge failure into something a user can act on. The bridge sends
 *  `{ "error": "..." }`, but a proxy in front of it may not, so the raw body is
 *  used as a fallback. */
export function describeBridgeError(status: number, body: string): string {
  const detail = extractError(body);

  switch (status) {
    case 401:
      return "bridge rejected the token — check the Bridge token setting.";
    case 404:
      return "bridge endpoint not found — check the Bridge URL setting.";
    case 413:
      return "the note is too large for the bridge to accept.";
    case 502:
      return `mail server error — ${detail || "the bridge could not reach IMAP/SMTP."}`;
    default:
      return detail ? `bridge returned ${status} — ${detail}` : `bridge returned ${status}.`;
  }
}

function extractError(body: string): string {
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
