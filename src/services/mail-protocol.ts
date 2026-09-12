/**
 * Pure request/response handling for the mail bridge.
 *
 * Kept free of `obsidian` imports so it stays unit-testable — the same split as
 * `llm-providers.ts` (pure) and `llm-client.ts` (transport). Everything the
 * bridge returns is remote JSON, so each field is validated rather than
 * trusted.
 */
import {
  asRecord,
  describeBridgeError as describeError,
  str,
  type UrlResult
} from "./bridge-protocol";

export { authHeaders, buildEndpoint, normalizeBaseUrl } from "./bridge-protocol";
export type { UrlResult } from "./bridge-protocol";

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

/** Mail's wording for a bridge failure; the shape of the answer is shared. */
export function describeBridgeError(status: number, body: string): string {
  if (status === 413) return "the note is too large for the bridge to accept.";
  if (status === 401) return "bridge rejected the token — check the Bridge token setting.";
  if (status === 404) return "bridge endpoint not found — check the Bridge URL setting.";
  return describeError(status, body, "mail server");
}

