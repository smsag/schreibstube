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

  const route = (path, handler) => ({
    method: "POST",
    path,
    capability: "mail",
    maxBytes: mail.maxBodyBytes,
    handler
  });

  return [
    route("/send", async ({ body, log }) => {
      const problem = validateSend(body, mail.maxTextChars);
      if (problem) throw httpError(400, "invalid_request", problem);

      const result = await upstream(
        () => sendMessage(mail, transport, body),
        config.upstreamTimeoutMs,
        "Send"
      );
      // Recipients are intentionally absent from the log line.
      log("info", `sent ${result.messageId} (filed in sent: ${result.filedInSent})`);
      return result;
    }),

    route("/search", async ({ body, log }) => {
      const result = await upstream(
        () => searchMessages(mail, body ?? {}),
        config.upstreamTimeoutMs,
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
 * Everything that leaves the process gets a deadline, and every failure out
 * there is a bad gateway rather than an internal error: the bridge is working,
 * the thing it called is not.
 */
async function upstream(work, timeoutMs, label) {
  try {
    return await withDeadline(work(), timeoutMs, label);
  } catch (err) {
    throw httpError(502, "upstream_error", `${label} failed: ${err.message}`);
  }
}

function validateSend(body, maxTextChars) {
  if (!body || typeof body !== "object") {
    return "Request body must be a JSON object.";
  }
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

function hasRecipient(value) {
  if (Array.isArray(value)) {
    return value.some((item) => String(item).trim().length > 0);
  }
  return typeof value === "string" && value.trim().length > 0;
}
