/**
 * Request and response handling for the mail bridge. Everything the bridge
 * returns is remote JSON, so each field is validated and bounded rather than
 * trusted.
 */
import {
  asRecord,
  describeBridgeError as describeError,
  extractCode,
  extractError,
  str
} from "./bridge-protocol";
import { safeAttachmentName, type SkipReason } from "./mail-import";

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

/**
 * What a search answer may carry before it stops being one. A default bridge
 * returns fifty messages and cuts a body at forty thousand characters, and an
 * operator may raise both; the plugin allows well above the defaults and no
 * more than a note can hold, so a bridge that is not ours cannot hand the
 * renderer a gigabyte.
 */
export const MAX_MAIL_RESULTS = 200;
export const MAX_MESSAGE_TEXT_CHARS = 400_000;
const MAX_HEADER_CHARS = 500;
const MAX_REFERENCES = 50;

/** RFC 5322: angle brackets around a token with no whitespace or brackets,
 *  and no line longer than 998 characters. */
const MESSAGE_ID = /^<[^\s<>]{1,998}>$/;

/** True when at least one criterion is set. An empty search would return the
 *  whole mailbox, which is never what the user meant. */
export function hasCriteria(criteria: SearchCriteria): boolean {
  return Object.values(criteria).some((value) => (value ?? "").trim().length > 0);
}

export function parseSearchResult(json: unknown): SearchResult {
  const root = asRecord(json);
  const rawMessages = Array.isArray(root.messages) ? root.messages : [];
  return {
    messages: rawMessages.slice(0, MAX_MAIL_RESULTS).map(parseMessage),
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
  if (!MESSAGE_ID.test(messageId)) {
    throw new Error("the bridge returned a malformed Message-ID.");
  }
  const sentAt = str(root.sentAt);
  if (sentAt && Number.isNaN(Date.parse(sentAt))) {
    throw new Error("the bridge returned a send time that is not a date.");
  }
  return {
    messageId,
    sentAt: sentAt || new Date().toISOString(),
    filedInSent: root.filedInSent === true,
    rejected: Array.isArray(root.rejected)
      ? root.rejected
          .slice(0, MAX_REJECTED)
          .map(str)
          .filter((address) => address.length > 0 && address.length <= MAX_ADDRESS_CHARS)
      : []
  };
}

/**
 * One message as the note will see it. A field that is not what it claims to
 * be — an identifier without brackets, a date that is not one — is dropped
 * rather than the whole answer, since it came from whoever wrote the mail.
 */
function parseMessage(raw: unknown): MailMessage {
  const record = asRecord(raw);
  const references = Array.isArray(record.references)
    ? record.references.map(str).filter(isMessageId).slice(0, MAX_REFERENCES)
    : [];
  const date = str(record.date);

  return {
    uid: typeof record.uid === "number" ? record.uid : 0,
    messageId: messageIdOrNull(record.messageId),
    inReplyTo: messageIdOrNull(record.inReplyTo),
    references,
    from: str(record.from).slice(0, MAX_HEADER_CHARS),
    to: str(record.to).slice(0, MAX_HEADER_CHARS),
    subject: str(record.subject).slice(0, MAX_HEADER_CHARS),
    date: date && !Number.isNaN(Date.parse(date)) ? date : null,
    text: str(record.text).slice(0, MAX_MESSAGE_TEXT_CHARS),
    truncated: record.truncated === true || str(record.text).length > MAX_MESSAGE_TEXT_CHARS
  };
}

function isMessageId(value: string): boolean {
  return MESSAGE_ID.test(value);
}

function messageIdOrNull(value: unknown): string | null {
  const id = str(value);
  return isMessageId(id) ? id : null;
}

/** Mail's wording for a bridge failure; the shape of the answer is shared. */
export function describeBridgeError(status: number, body: string): string {
  // The attachments route's own 404 and 413 say which mail, not which setting.
  const code = extractCode(body);
  if (code === "message_gone" || code === "message_too_large") return extractError(body);
  if (status === 413) return "the note is too large for the bridge to accept.";
  if (status === 401) return "bridge rejected the token — check the Bridge token setting.";
  if (status === 404) return "bridge endpoint not found — check the Bridge URL setting.";
  return describeError(status, body, "mail server");
}

/**
 * The first protocol whose bridge hands over a received mail's files. An older
 * one has no such route, and a 404 from it would read as a wrong URL.
 */
export const MAIL_IMPORT_PROTOCOL = 7;

/**
 * The bridge's limits on a received mail's files, mirrored so that an answer
 * beyond them is refused here: a bridge that is not ours cannot fill a phone.
 * The contract test on the bridge holds the two to the same numbers.
 */
export const MAX_IMPORT_ATTACHMENTS = 20;
export const MAX_IMPORT_ATTACHMENT_BYTES = 15_000_000;
export const MAX_IMPORT_TOTAL_BYTES = 25_000_000;

export interface AttachmentsRequest {
  uid: number;
  mailbox?: string;
}

export interface ImportedAttachment {
  filename: string;
  bytes: Uint8Array;
}

export interface SkippedAttachment {
  filename: string;
  reason: SkipReason;
}

export interface AttachmentsResult {
  attachments: ImportedAttachment[];
  skipped: SkippedAttachment[];
}

const SKIP_REASONS = new Set<SkipReason>(["type", "size", "limit"]);

/**
 * A received mail's files. A file whose name has no kind a note may hold, or
 * whose content is not base64, is named as left out rather than written; one
 * past the limits is refused along with the answer, since only a bridge that
 * is not ours would send it.
 */
export function parseAttachmentsResult(json: unknown): AttachmentsResult {
  const root = asRecord(json);
  const raw = Array.isArray(root.attachments) ? root.attachments : [];
  if (raw.length > MAX_IMPORT_ATTACHMENTS) {
    throw new Error(`the bridge returned more than ${MAX_IMPORT_ATTACHMENTS} attachments.`);
  }

  const attachments: ImportedAttachment[] = [];
  const skipped: SkippedAttachment[] = [];
  let total = 0;
  for (const entry of raw) {
    const record = asRecord(entry);
    const given = str(record.filename).slice(0, MAX_HEADER_CHARS);
    const filename = safeAttachmentName(given);
    const content = str(record.content);
    // Base64 is a third larger than what it carries; checked before decoding.
    if (content.length > Math.ceil(MAX_IMPORT_ATTACHMENT_BYTES / 3) * 4) {
      throw new Error("the bridge returned an attachment beyond its size limit.");
    }
    const bytes = filename ? fromBase64(content) : null;
    if (!filename || !bytes) {
      skipped.push({ filename: given || "?", reason: "type" });
      continue;
    }
    total += bytes.length;
    if (total > MAX_IMPORT_TOTAL_BYTES) {
      throw new Error("the bridge returned attachments beyond their total size limit.");
    }
    attachments.push({ filename, bytes });
  }

  const rawSkipped = Array.isArray(root.skipped) ? root.skipped : [];
  for (const entry of rawSkipped.slice(0, MAX_IMPORT_ATTACHMENTS * 2)) {
    const record = asRecord(entry);
    const reason = str(record.reason) as SkipReason;
    const filename = str(record.filename).slice(0, MAX_HEADER_CHARS);
    if (filename && SKIP_REASONS.has(reason)) skipped.push({ filename, reason });
  }

  return { attachments, skipped };
}

/**
 * Standard base64 only; anything else is not a file the bridge sent. A plain
 * character class, not groups of four: a pattern that repeats a group over
 * megabytes can exhaust the regular-expression engine's stack.
 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Base64 as bytes, or null for text that is not base64. */
export function fromBase64(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
