/**
 * The note ↔ email contract.
 *
 * A note carries its addressing in frontmatter; sending fills in the identity
 * fields that later let replies be found again:
 *
 *   ---
 *   schreibstubeTo: kunde@example.com
 *   schreibstubeCc: [innendienst@example.com]
 *   schreibstubeSubject: Angebot Objekt 4711
 *   schreibstubeMessageId: <7f3a…@your-domain.de>   # written on send
 *   schreibstubeSentAt: 2026-09-07T10:12:00Z        # written on send
 *   schreibstubeMergedIds: ["<reply-1@mail.kunde.de>"]
 *   ---
 *
 * Pure and `obsidian`-free so it stays unit-testable; the caller supplies the
 * already-parsed frontmatter object from the metadata cache.
 */

/* Every key is `schreibstube`-prefixed camelCase, the rule the rest of the
 * plugin follows: Obsidian frontmatter is one flat namespace shared with other
 * plugins and with the user's own properties, and bare `to` or `subject` would
 * be a collision waiting to happen. */
export const FM_TO = "schreibstubeTo";
export const FM_CC = "schreibstubeCc";
export const FM_SUBJECT = "schreibstubeSubject";
export const FM_MESSAGE_ID = "schreibstubeMessageId";
export const FM_SENT_AT = "schreibstubeSentAt";
export const FM_MERGED_IDS = "schreibstubeMergedIds";

export interface MailFields {
  to: string[];
  cc: string[];
  subject: string;
  messageId: string | null;
  mergedIds: string[];
}

export function readMailFields(frontmatter: unknown): MailFields {
  const record =
    typeof frontmatter === "object" && frontmatter !== null
      ? (frontmatter as Record<string, unknown>)
      : {};

  return {
    to: parseAddressList(record[FM_TO]),
    cc: parseAddressList(record[FM_CC]),
    subject: typeof record[FM_SUBJECT] === "string" ? record[FM_SUBJECT].trim() : "",
    messageId: parseMessageId(record[FM_MESSAGE_ID]),
    mergedIds: parseStringList(record[FM_MERGED_IDS])
  };
}

/** Accepts both YAML shapes users actually write: a comma-separated string and
 *  a list. */
export function parseAddressList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

/** YAML unquoted `<...>` is fine, but some editors strip the angle brackets.
 *  Normalise so the stored value always matches what IMAP will compare. */
function parseMessageId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("<") ? trimmed : `<${trimmed.replace(/^<|>$/g, "")}>`;
}

export type SendableResult = { ok: true } | { ok: false; message: string };

export function validateSendable(fields: MailFields): SendableResult {
  if (fields.to.length === 0 && fields.cc.length === 0) {
    return {
      ok: false,
      message: `add a "${FM_TO}:" recipient to the note's frontmatter first.`
    };
  }

  const invalid = [...fields.to, ...fields.cc].filter((address) => !looksLikeAddress(address));
  if (invalid.length > 0) {
    return { ok: false, message: `not a valid email address: ${invalid.join(", ")}` };
  }

  if (!fields.subject) {
    return {
      ok: false,
      message: `add a "${FM_SUBJECT}:" line to the note's frontmatter first.`
    };
  }

  return { ok: true };
}

/** A deliberately loose check — it catches typos and missing domains without
 *  trying to reimplement RFC 5322. The mail server is the real authority. */
function looksLikeAddress(value: string): boolean {
  const address = /<([^>]+)>/.exec(value)?.[1] ?? value;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address.trim());
}

/**
 * Return the note without its frontmatter block — the part that becomes the
 * email body. Handles both `---` and `...` terminators, and CRLF line endings.
 */
export function stripFrontmatter(content: string): string {
  if (!/^---\r?\n/.test(content)) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "...") {
      return lines.slice(i + 1).join("\n").replace(/^\n+/, "");
    }
  }

  // Unterminated frontmatter: treat the whole note as body rather than sending
  // an empty message.
  return content;
}
