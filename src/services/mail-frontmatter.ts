/**
 * The note ↔ email contract.
 *
 * A note carries its addressing in frontmatter; sending fills in the identity
 * fields that later let replies be found again:
 *
 *   ---
 *   schreibstubeTo: kunde@example.com
 *   schreibstubeCc: [innendienst@example.com]
 *   schreibstubeFrom: Büro <buero@your-domain.de>   # optional, per note
 *   schreibstubeSubject: Angebot Objekt 4711
 *   schreibstubeMessageId: <7f3a…@your-domain.de>   # written on send
 *   schreibstubeSentAt: 2026-09-07T10:12:00Z        # written on send
 *   schreibstubeSendUnconfirmed: 2026-09-07T10:12:00Z # a send whose outcome is unknown
 *   schreibstubeMergedIds: ["<reply-1@mail.kunde.de>"]
 *   ---
 *
 * Pure and `obsidian`-free so it stays unit-testable; the caller supplies the
 * already-parsed frontmatter object from the metadata cache.
 */

import { splitFrontmatter } from "./frontmatter-block";
import { isMessageId } from "./mail-protocol";
import { t } from "../i18n";

/* Every key is `schreibstube`-prefixed camelCase, the rule the rest of the
 * plugin follows: Obsidian frontmatter is one flat namespace shared with other
 * plugins and with the user's own properties, and bare `to` or `subject` would
 * be a collision waiting to happen. */
export const FM_TO = "schreibstubeTo";
export const FM_CC = "schreibstubeCc";
/** The sender for this one note, over the setting and the bridge's MAIL_FROM. */
export const FM_FROM = "schreibstubeFrom";
export const FM_SUBJECT = "schreibstubeSubject";
export const FM_MESSAGE_ID = "schreibstubeMessageId";
export const FM_SENT_AT = "schreibstubeSentAt";
export const FM_MERGED_IDS = "schreibstubeMergedIds";
/** When a send was attempted whose outcome never came back: it may have been
 *  delivered. Cleared by the next send that is confirmed. */
export const FM_SEND_UNCONFIRMED = "schreibstubeSendUnconfirmed";

export interface MailFields {
  to: string[];
  cc: string[];
  /** Empty when the note names no sender of its own. */
  from: string;
  subject: string;
  messageId: string | null;
  mergedIds: string[];
  /** A send that may or may not have gone out, or null. */
  unconfirmedAt: string | null;
}

export function readMailFields(frontmatter: unknown): MailFields {
  const record =
    typeof frontmatter === "object" && frontmatter !== null
      ? (frontmatter as Record<string, unknown>)
      : {};

  return {
    to: parseAddressList(record[FM_TO]),
    cc: parseAddressList(record[FM_CC]),
    from: typeof record[FM_FROM] === "string" ? record[FM_FROM].trim() : "",
    subject: typeof record[FM_SUBJECT] === "string" ? record[FM_SUBJECT].trim() : "",
    messageId: parseMessageId(record[FM_MESSAGE_ID]),
    mergedIds: parseStringList(record[FM_MERGED_IDS]),
    unconfirmedAt: parseTimestamp(record[FM_SEND_UNCONFIRMED])
  };
}

/** Accepts both YAML shapes users actually write: a comma-separated string and
 *  a list. */
export function parseAddressList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitAddresses(String(item)));
  }
  if (typeof value === "string") {
    return splitAddresses(value);
  }
  return [];
}

/**
 * Split at the commas between addresses, not the ones inside a name.
 *
 * `"Seitz, Steffen" <s@x.de>` is one recipient; a plain split made it two,
 * and the first half, `"Seitz`, was refused as not an address.
 */
export function splitAddresses(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let bracketed = false;

  for (const char of text) {
    if (char === '"' && !bracketed) quoted = !quoted;
    else if (char === "<" && !quoted) bracketed = true;
    else if (char === ">" && !quoted) bracketed = false;

    if (char === "," && !quoted && !bracketed) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** YAML reads an unquoted timestamp as a Date; a quoted one stays text. */
function parseTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

/**
 * YAML unquoted `<...>` is fine, but some editors strip the angle brackets.
 * Normalise so the stored value always matches what IMAP will compare.
 *
 * And refuse what is not a Message-ID once normalised. The bridge looks for
 * replies by a substring of their `References`, so a value of `<` matched
 * every reply to anything, and fetching replies merged a mailbox's threads
 * into one note.
 */
export function parseMessageId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const id = trimmed.startsWith("<") ? trimmed : `<${trimmed.replace(/^<|>$/g, "")}>`;
  return isMessageId(id) ? id : null;
}

/**
 * The most merged keys a note keeps. Every fetch sends them, and a thread
 * that someone floods with mail citing the note would otherwise grow its
 * frontmatter, and each request, without end. The newest are kept: they are
 * the ones the next fetch would find again.
 */
export const MAX_MERGED_IDS = 500;

/** A note's merged keys after a merge: what it had and what came, newest last. */
export function mergedIdsAfter(existing: unknown, added: readonly string[]): string[] {
  const kept = Array.isArray(existing) ? existing.map(String) : [];
  return [...kept, ...added].slice(-MAX_MERGED_IDS);
}

/** `missing`: the note lacks a value a key must hold, which a property set
 *  can start by adding the key; a wrong value it cannot fix. */
export type SendableResult = { ok: true } | { ok: false; message: string; missing: boolean };

export function validateSendable(fields: MailFields): SendableResult {
  if (fields.to.length === 0 && fields.cc.length === 0) {
    return {
      ok: false,
      message: t().mailNotices.needsRecipient(FM_TO),
      missing: true
    };
  }

  const invalid = [...fields.to, ...fields.cc].filter((address) => !looksLikeAddress(address));
  if (invalid.length > 0) {
    return {
      ok: false,
      message: t().mailNotices.invalidRecipient(invalid.join(", ")),
      missing: false
    };
  }

  // One sender, never a list: the bridge refuses two, and would do so only
  // after the dialogue had said the note was fine to send.
  if (fields.from && (splitAddresses(fields.from).length !== 1 || !looksLikeAddress(fields.from))) {
    return {
      ok: false,
      message: t().mailNotices.invalidSender(FM_FROM, fields.from),
      missing: false
    };
  }

  if (!fields.subject) {
    return {
      ok: false,
      message: t().mailNotices.needsSubject(FM_SUBJECT),
      missing: true
    };
  }

  // A line break in a header is a second header: a subject that carried one
  // would let a note write its own `Bcc:`.
  if (CONTROL_CHARS.test(fields.subject)) {
    return {
      ok: false,
      message: t().mailNotices.invalidSubject(FM_SUBJECT),
      missing: false
    };
  }

  return { ok: true };
}

/** Every control character, line breaks included; the class spares a list the linter refuses. */
const CONTROL_CHARS = /\p{Cc}/u;

/** A deliberately loose check — it catches typos and missing domains without
 *  trying to reimplement RFC 5322. The mail server is the real authority. A
 *  control character anywhere in the value, name included, is refused: it is
 *  never part of an address and is how a header is smuggled into another. */
export function looksLikeAddress(value: string): boolean {
  if (CONTROL_CHARS.test(value)) return false;
  const address = /<([^>]+)>/.exec(value)?.[1] ?? value;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address.trim());
}

/** The note without its frontmatter block: the part that becomes the mail body. */
export function stripFrontmatter(content: string): string {
  const { block, body } = splitFrontmatter(content);
  return block ? body.replace(/\r\n/g, "\n").replace(/^\n+/, "") : content;
}
