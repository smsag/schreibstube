/**
 * Request and response handling for the mail bridge. Everything the bridge
 * returns is remote JSON, so each field is validated and bounded rather than
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
  if (status === 413) return "the note is too large for the bridge to accept.";
  if (status === 401) return "bridge rejected the token — check the Bridge token setting.";
  if (status === 404) return "bridge endpoint not found — check the Bridge URL setting.";
  return describeError(status, body, "mail server");
}
