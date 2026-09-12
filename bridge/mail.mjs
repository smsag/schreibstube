/**
 * IMAP/SMTP work for the bridge.
 *
 * Connections are opened per request and closed again: the bridge serves one
 * user at a low request rate, so a long-lived IMAP session would only add
 * reconnect and keepalive handling without a measurable win.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";

/**
 * Compile a message to RFC 5322 bytes without sending it. Using a stream
 * transport keeps us on nodemailer's public API while still yielding the raw
 * source, which we need twice: once for SMTP and once for the IMAP APPEND that
 * files the copy in Sent (SMTP itself never does this).
 */
const compiler = nodemailer.createTransport({
  streamTransport: true,
  buffer: true,
  newline: "windows"
});

export function createSmtpTransport(config, timeoutMs) {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.auth,
    requireTLS: !config.smtp.secure,
    // Without these, a server that accepts the connection and then says nothing
    // holds the request until the client gives up.
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs
  });
}

/**
 * Prove the mailbox is reachable with the configured credentials.
 *
 * Used by /diagnostics, which exists because a health check that only says a
 * process is alive cannot answer "is my configuration right". Each protocol is
 * reported on its own: SMTP working while IMAP does not is a real and common
 * state, and the distinction is the whole value of the answer.
 */
export async function diagnose(config, transport) {
  return {
    imap: await attempt(async () => {
      const client = newClient(config);
      try {
        await client.connect();
        const lock = await client.getMailboxLock(config.defaultMailbox);
        lock.release();
        return { mailbox: config.defaultMailbox };
      } finally {
        await safeLogout(client);
      }
    }),
    smtp: await attempt(async () => {
      await transport.verify();
      return {};
    })
  };
}

async function attempt(work) {
  try {
    return { ok: true, ...(await work()) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Send a message and file a copy in Sent.
 *
 * The Message-ID is generated here rather than left to nodemailer so the value
 * is known before the send and can be returned to the plugin, which stores it
 * in the note's frontmatter. That stored ID is the only thing tying later
 * replies back to the note, so it must survive the round trip intact.
 */
export async function sendMessage(config, transport, request) {
  const from = request.from?.trim() || config.from;
  const messageId = request.messageId?.trim() || generateMessageId(from);

  // Note the absence of `bcc`: the compiled bytes go out verbatim and are
  // APPENDed to Sent, so a Bcc header here would expose blind recipients to
  // everyone. Blind recipients are carried in the SMTP envelope instead.
  const mail = {
    from,
    to: joinAddresses(request.to),
    cc: joinAddresses(request.cc),
    subject: request.subject,
    text: request.text,
    messageId,
    inReplyTo: request.inReplyTo || undefined,
    references: request.references?.length ? request.references : undefined
  };

  const compiled = await compiler.sendMail(mail);
  const raw = compiled.message;

  await transport.sendMail({
    envelope: {
      from: extractAddress(from),
      to: [...toList(request.to), ...toList(request.cc), ...toList(request.bcc)]
    },
    raw
  });

  const sentAt = new Date().toISOString();
  const filed = await appendToSent(config, raw);

  return { messageId, sentAt, filedInSent: filed };
}

/** APPEND the sent copy to the Sent mailbox. A failure here is reported but not
 *  fatal: the mail is already delivered, and losing the local copy must not
 *  look like a failed send. */
async function appendToSent(config, raw) {
  if (!config.sentMailbox) {
    return false;
  }
  const client = newClient(config);
  try {
    await client.connect();
    await client.append(config.sentMailbox, raw, ["\\Seen"]);
    return true;
  } catch {
    return false;
  } finally {
    await safeLogout(client);
  }
}

/** Search a mailbox and return the matching messages, newest last. */
export async function searchMessages(config, request) {
  const mailbox = request.mailbox?.trim() || config.defaultMailbox;
  const limit = clampLimit(request.limit, config.maxResults);
  const client = newClient(config);

  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const uids = await client.search(buildQuery(request.criteria ?? {}), { uid: true });
      if (!uids || uids.length === 0) {
        return { messages: [], mailbox, truncated: false };
      }

      // Newest UIDs are highest, so the tail is the most recent window.
      const window = uids.slice(-limit);
      const messages = [];
      for await (const msg of client.fetch(window, { uid: true, source: true }, { uid: true })) {
        messages.push(await toMessage(msg, config.maxTextChars));
      }
      messages.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

      return { messages, mailbox, truncated: uids.length > window.length };
    } finally {
      lock.release();
    }
  } finally {
    await safeLogout(client);
  }
}

/**
 * Clamp from both ends. A negative or non-numeric limit would turn the
 * `slice(-limit)` below into a positive offset, returning the oldest matches
 * and far more of them than `maxResults` — every one fully parsed.
 */
function clampLimit(value, maxResults) {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(n) || n < 1) {
    return Math.min(25, maxResults);
  }
  return Math.min(n, maxResults);
}

/**
 * Translate the plugin's criteria into an IMAP SEARCH query.
 *
 * `references` is the thread lookup: a reply may cite the original in either
 * References or In-Reply-To depending on the sending client, so both are
 * matched. Distinct keys at the top level are ANDed by IMAP.
 */
function buildQuery(criteria) {
  const clauses = [];
  if (criteria.from?.trim()) clauses.push({ from: criteria.from.trim() });
  if (criteria.to?.trim()) clauses.push({ to: criteria.to.trim() });
  if (criteria.subject?.trim()) clauses.push({ subject: criteria.subject.trim() });
  if (criteria.text?.trim()) clauses.push({ text: criteria.text.trim() });
  if (criteria.since) {
    const since = new Date(criteria.since);
    if (!Number.isNaN(since.getTime())) clauses.push({ since });
  }
  if (criteria.references?.trim()) {
    const id = criteria.references.trim();
    clauses.push({
      or: [{ header: { references: id } }, { header: { "in-reply-to": id } }]
    });
  }
  return clauses.length === 0 ? { all: true } : Object.assign({}, ...clauses);
}

async function toMessage(msg, maxTextChars) {
  const parsed = await simpleParser(msg.source);
  const text = parsed.text?.trim() || htmlToText(parsed.html || "");

  return {
    uid: msg.uid,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references: normalizeReferences(parsed.references),
    from: parsed.from?.text ?? "",
    to: parsed.to?.text ?? "",
    subject: parsed.subject ?? "",
    date: parsed.date ? parsed.date.toISOString() : null,
    text: text.slice(0, maxTextChars),
    truncated: text.length > maxTextChars
  };
}

/** mailparser gives a string for a single reference and an array for several. */
function normalizeReferences(references) {
  if (!references) return [];
  return Array.isArray(references) ? references : [references];
}

/** Last-resort plain text for HTML-only mail. Deliberately crude: block-level
 *  tags become line breaks, everything else is dropped. Good enough to read in
 *  a note; anything richer belongs in a proper converter. */
function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function newClient(config) {
  return new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: config.imap.auth,
    logger: false,
    emitLogs: false,
    greetingTimeout: config.upstreamTimeoutMs,
    socketTimeout: config.upstreamTimeoutMs
  });
}

async function safeLogout(client) {
  try {
    await client.logout();
  } catch {
    client.close();
  }
}

function generateMessageId(from) {
  const domain = extractAddress(from).split("@")[1] || "localhost";
  return `<${randomUUID()}@${domain}>`;
}

function extractAddress(value) {
  const match = /<([^>]+)>/.exec(value ?? "");
  return (match ? match[1] : value ?? "").trim();
}

function toList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(",");
  return items.map((item) => extractAddress(String(item))).filter(Boolean);
}

function joinAddresses(value) {
  if (!value) return undefined;
  const items = Array.isArray(value) ? value : [value];
  const joined = items.map((item) => String(item).trim()).filter(Boolean).join(", ");
  return joined || undefined;
}
