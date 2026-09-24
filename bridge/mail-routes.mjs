/**
 * The mail capability: its routes, its validation and its handlers.
 *
 * A handler returns a payload and throws for anything that is not a success,
 * so it never touches the response and can be read as the operation it is. The
 * server writes the result.
 */
import { httpError } from "./http.mjs";
import { withDeadline } from "./timeout.mjs";
import { createSmtpTransport, diagnose, searchMessages, sendMessage } from "./mail.mjs";

export function createMailRoutes(config) {
  const mail = { ...config.mail, upstreamTimeoutMs: config.upstreamTimeoutMs };
  const transport = createSmtpTransport(mail, config.upstreamTimeoutMs);

  const route = (path, handler, timeoutMs) => ({
    method: "POST",
    path,
    capability: "mail",
    maxBytes: mail.maxBodyBytes,
    handler,
    timeoutMs
  });

  // A send is two upstream legs with a deadline each, delivery and filing in
  // Sent. The request has to outlast both, or the server's own deadline would
  // report a delivered message as a failure all the same.
  const sendTimeoutMs = Math.max(config.requestTimeoutMs, 2 * config.upstreamTimeoutMs + 5_000);

  return [
    route(
      "/send",
      async ({ body, log }) => {
        const problem = validateSend(body, mail.maxTextChars);
        if (problem) throw httpError(400, "invalid_request", problem);

        // sendMessage keeps a deadline per leg itself; one around the whole of
        // it would cut the filing short and fail a send that was delivered.
        const result = await upstream(() => sendMessage(mail, transport, body), "Send");
        // Recipients are intentionally absent from the log line.
        log("info", `sent ${result.messageId} (filed in sent: ${result.filedInSent})`);
        return result;
      },
      sendTimeoutMs
    ),

    route("/search", async ({ body, log }) => {
      const problem = validateSearch(body ?? {});
      if (problem) throw httpError(400, "invalid_request", problem);

      const result = await upstream(
        () => withDeadline(searchMessages(mail, body ?? {}), config.upstreamTimeoutMs, "Search"),
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
    throw httpError(502, "upstream_error", `${label} failed: ${err.message}`);
  }
}

function validateSend(body, maxTextChars) {
  if (!hasRecipient(body.to) && !hasRecipient(body.cc) && !hasRecipient(body.bcc)) {
    return "At least one recipient (to, cc or bcc) is required.";
  }
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return "A non-empty subject is required.";
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return "A non-empty text body is required.";
  }
  if (body.text.length > maxTextChars) {
    return `Body exceeds the ${maxTextChars} character limit.`;
  }
  return null;
}

/**
 * The search body, checked before anything reads it.
 *
 * Every field here was used with `?.trim()` on whatever arrived, so
 * `{"mailbox": 5}` threw a TypeError deep in the IMAP call and came back as a
 * 502 quoting the bridge's own source. A wrongly typed field is the caller's
 * mistake and is answered as one.
 */
function validateSearch(body) {
  if (body.mailbox !== undefined && typeof body.mailbox !== "string") {
    return "mailbox must be a string.";
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

  for (const field of ["from", "to", "subject", "text"]) {
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

function hasRecipient(value) {
  if (Array.isArray(value)) {
    return value.some((item) => String(item).trim().length > 0);
  }
  return typeof value === "string" && value.trim().length > 0;
}
