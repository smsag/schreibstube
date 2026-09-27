/**
 * Pure request/response handling for the mail bridge.
 *
 * Kept free of `obsidian` imports so it stays unit-testable — the same split as
 * `llm-providers.ts` (pure) and `llm-client.ts` (transport). Everything the
 * bridge returns is remote JSON, so each field is validated rather than
 * trusted.
 */
import { asRecord, describeBridgeError as describeError, str } from "./bridge-protocol";

/** How long to wait for a bridge response before giving up. Longer than the
 *  bridge's own allowance for a send, 45 s by default for delivery and filing
 *  in Sent: a plugin that gives up first reports a delivered message as a
 *  failure, and the user sends it again. */
export const MAIL_REQUEST_TIMEOUT_MS = 60_000;

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
  /** The note's diagrams, drawn. Protocol 5; left out entirely when there are none. */
  attachments?: MailAttachment[];
}

export interface MailAttachment {
  filename: string;
  contentType: "image/png";
  /** Base64, as JSON carries bytes. */
  content: string;
}

/**
 * The first protocol whose bridge takes pictures on a send.
 *
 * An older bridge ignores a field it does not know, and would deliver the mail
 * without its pictures while the text points at them. So the plugin asks
 * first, and sends a diagram as its source to a bridge that cannot take one.
 */
export const MAIL_ATTACHMENTS_PROTOCOL = 5;

/**
 * The bridge's limits on pictures, mirrored so that a mail is never built that
 * the bridge would refuse: a refused send is a person waiting for nothing. The
 * contract test on the bridge holds the two to the same numbers.
 */
export const MAX_MAIL_ATTACHMENTS = 10;
export const MAX_MAIL_ATTACHMENT_BYTES = 4_000_000;
export const MAX_MAIL_ATTACHMENTS_TOTAL_BYTES = 10_000_000;

/** Bytes as base64, a slice at a time: one spread of megabytes overflows the stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const slice = 0x8000;
  for (let at = 0; at < bytes.length; at += slice) {
    binary += String.fromCharCode(...bytes.subarray(at, at + slice));
  }
  return btoa(binary);
}

export interface SendResult {
  messageId: string;
  sentAt: string;
  filedInSent: boolean;
  /** Recipients the mail server turned down; the rest were accepted. Empty
   *  from a bridge before protocol 4, which did not report them. */
  rejected: string[];
}

/** More refused recipients than a note can address is not an answer to trust. */
const MAX_REJECTED = 100;
const MAX_ADDRESS_CHARS = 320;

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
    filedInSent: root.filedInSent === true,
    rejected: Array.isArray(root.rejected)
      ? root.rejected
          .slice(0, MAX_REJECTED)
          .map(str)
          .filter((address) => address.length > 0 && address.length <= MAX_ADDRESS_CHARS)
      : []
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
