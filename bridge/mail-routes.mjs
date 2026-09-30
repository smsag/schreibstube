/**
 * The mail capability: its routes, its validation and its handlers.
 *
 * A handler returns a payload and throws for anything that is not a success,
 * so it never touches the response and can be read as the operation it is. The
 * server writes the result.
 */
import { httpError } from "./http.mjs";
import { withDeadline } from "./timeout.mjs";
import {
  createSmtpTransport,
  diagnose,
  searchMessages,
  sendMessage,
  SendUnconfirmedError
} from "./mail.mjs";
import { parseSender, recipientAddresses } from "./mail-address.mjs";
import { checkAttachments, maxSendBodyBytes } from "./mail-attachments.mjs";

/** RFC 5322's line limit; a header longer than that is folded or refused. */
export const MAX_HEADER_CHARS = 998;

/** A thread deeper than this is not a thread a note is part of. */
export const MAX_REFERENCES = 100;

/** A mailbox name; IMAP servers cap them far lower. */
export const MAX_MAILBOX_CHARS = 255;

export function createMailRoutes(
  config,
  { transport = createSmtpTransport(config.mail, config.upstreamTimeoutMs) } = {}
) {
  const mail = { ...config.mail, upstreamTimeoutMs: config.upstreamTimeoutMs };

  const route = (path, handler, timeoutMs, maxBytes = mail.maxBodyBytes) => ({
    method: "POST",
    path,
    capability: "mail",
    maxBytes,
    handler,
    timeoutMs
  });

  // Two upstream legs with a deadline each, and the request outlasts both.
  const sendTimeoutMs = Math.max(config.requestTimeoutMs, 2 * config.upstreamTimeoutMs + 5_000);

  return [
    route(
      "/send",
      async ({ body, log }) => {
        const problem = validateSend(body, mail.maxTextChars);
        if (problem) throw httpError(400, "invalid_request", problem);
        const checked = checkAttachments(body.attachments);
        if (checked.problem) throw httpError(400, "invalid_request", checked.problem);
        const request = { ...body, attachments: checked.attachments };

        const result = await upstream(() => sendMessage(mail, transport, request, { log }), "Send");
        // Recipients are intentionally absent from the log line.
        log(
          result.rejected.length > 0 ? "warn" : "info",
          `sent ${result.messageId} (filed in sent: ${result.filedInSent}, ` +
            `refused recipients: ${result.rejected.length}, ` +
            `attachments: ${request.attachments.length})`
        );
        return result;
      },
      sendTimeoutMs,
      maxSendBodyBytes(mail.maxBodyBytes)
    ),

    route("/search", async ({ body, log }) => {
      const problem = validateSearch(body ?? {});
      if (problem) throw httpError(400, "invalid_request", problem);

      const result = await upstream(
        () =>
          withDeadline(searchMessages(mail, body ?? {}, log), config.upstreamTimeoutMs, "Search"),
        "Search"
      );
      log("info", `search returned ${result.messages.length} message(s) from ${result.mailbox}`);
      return result;
    }),

    route("/diagnostics", async ({ log }) => {
      const result = await diagnose(mail, transport);
      log(
        "info",
        `diagnostics: imap ${result.imap.ok ? "ok" : "failed"}, smtp ${result.smtp.ok ? "ok" : "failed"}`
      );
      return result;
    })
  ];
}

/**
 * Every failure out there is a bad gateway rather than an internal error: the
 * bridge is working, the thing it called is not. The deadline is the caller's,
 * because a send needs one per leg rather than one over both.
 */
async function upstream(work, label) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof SendUnconfirmedError) {
      throw httpError(504, "send_unconfirmed", err.message);
    }
    throw httpError(502, "upstream_error", `${label} failed: ${err.message}`);
  }
}

/**
 * The send body, checked before anything is compiled from it. Recipients are
 * read with the parser that builds the envelope, so what passes here is what
 * the server is asked to deliver to, and a "recipient" with no address in it
 * is refused rather than sent to nobody.
 */
export function validateSend(body, maxTextChars) {
  for (const field of ["to", "cc", "bcc"]) {
    const problem = checkRecipientField(body[field], field);
    if (problem) return problem;
  }
  const recipients = [
    ...recipientAddresses(body.to),
    ...recipientAddresses(body.cc),
    ...recipientAddresses(body.bcc)
  ];
  if (recipients.length === 0) {
    return "At least one recipient (to, cc or bcc) is required.";
  }
  if (recipients.some((address) => !address.includes("@"))) {
    return "Every recipient must be an address.";
  }
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return "A non-empty subject is required.";
  }
  if (body.subject.length > MAX_HEADER_CHARS) {
    return `Subject exceeds the ${MAX_HEADER_CHARS} character limit.`;
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return "A non-empty text body is required.";
  }
  if (body.text.length > maxTextChars) {
    return `Body exceeds the ${maxTextChars} character limit.`;
  }
  if (body.from !== undefined && body.from !== null) {
    if (typeof body.from !== "string") return "from must be a string.";
    if (body.from.trim() && !parseSender(body.from)) {
      return 'from must be one address, alone or after a name: "Name <you@example.de>".';
    }
  }
  if (body.inReplyTo !== undefined && body.inReplyTo !== null) {
    if (typeof body.inReplyTo !== "string" || body.inReplyTo.length > MAX_HEADER_CHARS) {
      return `inReplyTo must be a string of at most ${MAX_HEADER_CHARS} characters.`;
    }
  }
  if (body.references !== undefined && body.references !== null) {
    if (!Array.isArray(body.references) || body.references.length > MAX_REFERENCES) {
      return `references must be a list of at most ${MAX_REFERENCES} Message-IDs.`;
    }
    if (
      body.references.some((item) => typeof item !== "string" || item.length > MAX_HEADER_CHARS)
    ) {
      return `Every reference must be a string of at most ${MAX_HEADER_CHARS} characters.`;
    }
  }
  return null;
}

/** A recipient field is a string or a list of strings, or absent. */
function checkRecipientField(value, field) {
  if (value === undefined || value === null) return null;
  const items = Array.isArray(value) ? value : [value];
  if (items.some((item) => typeof item !== "string")) {
    return `${field} must be a string or a list of strings.`;
  }
  if (items.some((item) => item.length > MAX_HEADER_CHARS)) {
    return `${field} exceeds the ${MAX_HEADER_CHARS} character limit.`;
  }
  // A name alone parses to no address at all, which is not "no recipient".
  if (items.some((item) => item.trim() && recipientAddresses(item).length === 0)) {
    return "Every recipient must be an address.";
  }
  return null;
}

/** The search body, checked before anything reads it: a wrongly typed field
 *  is the caller's mistake and is answered as one, not as a 502. */
export function validateSearch(body) {
  if (body.mailbox !== undefined) {
    if (typeof body.mailbox !== "string") return "mailbox must be a string.";
    if (body.mailbox.length > MAX_MAILBOX_CHARS) {
      return `mailbox exceeds the ${MAX_MAILBOX_CHARS} character limit.`;
    }
  }
  if (
    body.limit !== undefined &&
    typeof body.limit !== "number" &&
    typeof body.limit !== "string"
  ) {
    return "limit must be a number.";
  }
  if (body.criteria === undefined) return null;
  if (typeof body.criteria !== "object" || body.criteria === null || Array.isArray(body.criteria)) {
    return "criteria must be an object.";
  }

  for (const field of ["from", "to", "subject", "text", "references"]) {
    if (body.criteria[field] !== undefined && typeof body.criteria[field] !== "string") {
      return `criteria.${field} must be a string.`;
    }
  }
  if (body.criteria.since !== undefined) {
    const since = new Date(body.criteria.since);
    if (Number.isNaN(since.getTime())) return "criteria.since must be a date.";
  }

  return null;
}
