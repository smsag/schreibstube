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
import { TimeoutError, withDeadline } from "./timeout.mjs";
import { parseSender, recipientAddresses, senderDomain } from "./mail-address.mjs";
import { chooseSentMailbox, FALLBACK_SENT_MAILBOX } from "./sent-mailbox.mjs";
import {
  addressText,
  matchableWithoutServer,
  matchesCriteria,
  MAX_FALLBACK_SCAN
} from "./mail-match.mjs";

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
 * Prove the mailbox is reachable with the configured credentials, each
 * protocol on its own: SMTP working while IMAP does not is a real and common
 * state, and the distinction is the whole value of the answer.
 */
export async function diagnose(config, transport) {
  return {
    imap: await attempt(config.upstreamTimeoutMs, "IMAP", async () => {
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
    smtp: await attempt(config.upstreamTimeoutMs, "SMTP", async () => {
      await transport.verify();
      return {};
    })
  };
}

/**
 * One protocol's answer, under its own deadline: a server that neither
 * answers nor hangs up used to run the request into the bridge's deadline,
 * and a 504 says nothing about which protocol it was.
 */
async function attempt(timeoutMs, label, work) {
  try {
    return { ok: true, ...(await withDeadline(work(), timeoutMs, label)) };
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
 *
 * The two legs carry a deadline each. One deadline over both turned a slow
 * APPEND after a delivered message into a failed send, and a person told the
 * send failed sends again: the duplicate lands with the recipient.
 */
export async function sendMessage(
  config,
  transport,
  request,
  { fileInSent = appendToSent, log = () => {} } = {}
) {
  const account = parseSender(config.from);
  const from = parseSender(request.from) ?? account;
  const messageId = generateMessageId(from);

  // Note the absence of `bcc`: the compiled bytes go out verbatim and are
  // APPENDed to Sent, so a Bcc header here would expose blind recipients to
  // everyone. Blind recipients are carried in the SMTP envelope instead.
  const mail = {
    from: from.name ? { name: from.name, address: from.address } : from.address,
    to: joinAddresses(request.to),
    cc: joinAddresses(request.cc),
    subject: request.subject,
    text: request.text,
    messageId,
    inReplyTo: request.inReplyTo || undefined,
    references: request.references?.length ? request.references : undefined,
    attachments: request.attachments?.length
      ? request.attachments.map(({ filename, contentType, content }) => ({
          filename,
          contentType,
          content
        }))
      : undefined
  };

  const compiled = await compiler.sendMail(mail);
  const raw = compiled.message;

  let delivery;
  try {
    delivery = await withDeadline(
      transport.sendMail({
        envelope: {
          from: account.address,
          to: [
            ...recipientAddresses(request.to),
            ...recipientAddresses(request.cc),
            ...recipientAddresses(request.bcc)
          ]
        },
        raw
      }),
      config.upstreamTimeoutMs,
      "Send"
    );
  } catch (err) {
    if (isUnconfirmed(err)) throw new SendUnconfirmedError(err);
    throw err;
  }

  const sentAt = new Date().toISOString();
  // Not filed is reported, never a failed send; but said in the log, because
  // "check SENT_MAILBOX" is the only advice the README can give without it.
  const filed = await withDeadline(
    fileInSent(config, raw),
    config.upstreamTimeoutMs,
    "Filing in Sent"
  ).catch((err) => {
    log("warn", `sent copy of ${messageId} not filed: ${err.message}`);
    return false;
  });

  const rejected = Array.isArray(delivery?.rejected) ? delivery.rejected.map(String) : [];

  return { messageId, sentAt, filedInSent: filed, rejected };
}

/** A send whose outcome the bridge does not know; the route answers it as such. */
export class SendUnconfirmedError extends Error {
  constructor(cause) {
    super(
      `The mail server did not confirm the send (${cause.message}). ` +
        "It may still be delivered — check Sent before sending again."
    );
    this.name = "SendUnconfirmedError";
  }
}

/** nodemailer's codes for a line that failed rather than a server that answered. */
const CONNECTION_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET"]);

/**
 * Our own deadline, or a connection that was lost or fell silent while the
 * message was in the server's hands. A reply the server did give — a refused
 * login, a refused recipient, a refused message — carries its response code
 * and is a failure it reported. nodemailer says nothing about which command
 * a dropped connection interrupted, so the wording is what tells a line that
 * went away from one that was never opened.
 */
export function isUnconfirmed(err) {
  if (err instanceof TimeoutError) return true;
  if (err?.responseCode) return false;
  // nodemailer reports a socket error as ESOCKET with the socket's own words
  // (read ECONNRESET, write EPIPE), a hang-up as ECONNECTION "closed
  // unexpectedly", and its own silence as ETIMEDOUT "Timeout".
  return (
    CONNECTION_CODES.has(err?.code) &&
    /closed unexpectedly|^Timeout|ECONNRESET|EPIPE|ECONNABORTED/i.test(err?.message ?? "")
  );
}

async function appendToSent(config, raw) {
  if (config.sentMailbox === "") {
    return false;
  }
  const client = newClient(config);
  try {
    await client.connect();
    const { mailbox, filedByServer } = await sentMailboxFor(config, client);
    if (!mailbox) return filedByServer;
    await client.append(mailbox, raw, ["\\Seen"]);
    return true;
  } finally {
    await safeLogout(client);
  }
}

/**
 * The server's answer, per mailbox account, for the life of the process.
 *
 * Folders are renamed about never, and a LIST before every send would be one
 * more round trip inside the filing deadline for the same answer each time. A
 * redeploy asks again.
 */
const detectedSent = new Map();

/** A LIST that fails is not remembered — the next send asks again — and
 *  falls back to the old default for this one. */
export async function sentMailboxFor(config, client, cache = detectedSent) {
  const configured = config.sentMailbox ?? null;
  if (configured !== null) return chooseSentMailbox({ configured });

  const key = `${config.imap.host}:${config.imap.port}|${config.imap.auth.user}`;
  if (cache.has(key)) return cache.get(key);

  let choice;
  try {
    choice = chooseSentMailbox({
      mailboxes: await client.list(),
      capabilities: [...(client.capabilities?.keys?.() ?? [])]
    });
  } catch {
    return { mailbox: FALLBACK_SENT_MAILBOX, filedByServer: false };
  }
  cache.set(key, choice);
  return choice;
}

/**
 * Search a mailbox and return the matching messages, newest last. `log`, when
 * given, hears why a search took the long way round.
 */
export async function searchMessages(config, request, log = () => {}) {
  const mailbox = request.mailbox?.trim() || config.defaultMailbox;
  const limit = clampLimit(request.limit, config.maxResults);
  const warnings = [];
  const client = newClient(config, warnings);

  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const criteria = request.criteria ?? {};
      const advertisedWithin = ignoreWithin(client);
      let uids = await client.search(buildQuery(criteria), { uid: true });
      const serverFound = uids === false ? "refused" : uids.length;
      let scanMissedOlder = false;
      let scanned = "not needed";
      if (uids === false) {
        const refusal = refusalMessage("The mail server refused the search", warnings);
        if (!matchableWithoutServer(criteria)) throw new Error(refusal);
        log("warn", `${refusal}; matching the newest ${MAX_FALLBACK_SCAN} messages instead`);
        ({ uids, scanMissedOlder } = await scanNewest(client, criteria, log));
        scanned = uids.length;
      } else if (uids.length === 0 && matchableWithoutServer(criteria)) {
        // A second opinion: Strato answered a date-only search with nothing
        // while its INBOX held mail from that week, and gave no error to go on.
        // Reading the newest envelopes costs one short FETCH and settles it.
        ({ uids, scanMissedOlder } = await scanNewest(client, criteria, log));
        scanned = uids.length;
      }
      log("info", searchReport(client, criteria, serverFound, scanned, advertisedWithin));
      if (uids.length === 0) {
        return { messages: [], mailbox, truncated: scanMissedOlder };
      }

      // Newest UIDs are highest, so the tail is the most recent window.
      const window = uids.slice(-limit);
      const messages = [];
      // A bound on the download, not only on what is kept: without one, fifty
      // messages with attachments were pulled into memory in full and parsed
      // before `maxTextChars` trimmed anything.
      const bodies = { seen: new Set(), skipped: [] };
      await fetchEach(
        client,
        window,
        { uid: true, source: { maxLength: config.maxMessageBytes } },
        { uid: true },
        async (msg) => messages.push(await toMessage(msg, config.maxTextChars)),
        bodies
      );
      reportSkipped(log, "UID", bodies.skipped);
      if (messages.length === 0) {
        throw new Error(
          refusalMessage(
            `The mail server found ${uids.length} message(s) but returned none of them`,
            warnings
          )
        );
      }
      messages.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

      return { messages, mailbox, truncated: scanMissedOlder || uids.length > window.length };
    } finally {
      lock.release();
    }
  } finally {
    await safeLogout(client);
  }
}

/**
 * Keep imapflow on SINCE. When a server advertises WITHIN, imapflow turns a
 * `since` date into `YOUNGER <seconds>`, and Strato, which advertises it after
 * login, answers every YOUNGER with no matches and no error. SINCE is plain
 * IMAP4rev1 that every server implements. The capability is dropped right
 * before the search, after login and SELECT, which is when the server reports
 * it. Returns whether the server had advertised it, for the log.
 */
export function ignoreWithin(client) {
  if (!(client.capabilities instanceof Map)) return false;
  return client.capabilities.delete("WITHIN");
}

/**
 * One line on how a search went, for the bridge log: enough to tell a mailbox
 * that holds nothing from a server whose search is wrong. The criteria are
 * named, never quoted, since they carry addresses and subjects.
 */
export function searchReport(client, criteria, serverFound, scanned, within) {
  const named = Object.keys(criteria)
    .filter((key) => typeof criteria[key] === "string" && criteria[key].trim())
    .sort();
  return (
    `search in ${client.mailbox?.path ?? "?"} ` +
    `(exists ${client.mailbox?.exists ?? "?"}, uidNext ${client.mailbox?.uidNext ?? "?"}, ` +
    `within ${within ? "yes" : "no"}) ` +
    `on ${named.join("+") || "nothing"}: server found ${serverFound}, own check found ${scanned}`
  );
}

/**
 * The search done without the server's SEARCH: the newest messages by sequence
 * number, read as envelopes and matched in `mail-match.mjs`. Reading needs no
 * search, so a server that refuses one still hands these over.
 */
async function scanNewest(client, criteria, log = () => {}) {
  const exists = client.mailbox?.exists ?? 0;
  if (exists === 0) return { uids: [], scanMissedOlder: false };

  const first = Math.max(1, exists - MAX_FALLBACK_SCAN + 1);
  const sequence = Array.from({ length: exists - first + 1 }, (_, i) => first + i);
  const uids = [];
  const envelopes = { seen: new Set(), skipped: [] };
  const query = {
    uid: true,
    envelope: true,
    internalDate: true,
    headers: ["references", "in-reply-to"]
  };
  await fetchEach(
    client,
    sequence,
    query,
    {},
    (msg) => {
      const candidate = {
        from: addressText(msg.envelope?.from),
        to: addressText(msg.envelope?.to),
        subject: msg.envelope?.subject ?? "",
        date: msg.internalDate ?? msg.envelope?.date ?? null,
        headers: msg.headers?.toString("utf8") ?? ""
      };
      if (matchesCriteria(candidate, criteria)) uids.push(msg.uid);
    },
    envelopes
  );
  reportSkipped(log, "sequence number", envelopes.skipped);
  return { uids: uids.sort((a, b) => a - b), scanMissedOlder: first > 1 };
}

/** How many skipped messages a log line names before it only counts them. */
export const MAX_SKIPPED_NAMED = 10;

/**
 * FETCH `ids`, handing each message to `onRow` once, and step around a message
 * the server will not hand over. Strato failed on one reply every client
 * asked it for, and one refusal fails the whole command: a batch that fails
 * is halved until the failure is a single message, which is left out and
 * recorded in `state.skipped`. A dropped connection is not one message's
 * fault and still fails the search.
 */
export async function fetchEach(client, ids, query, options, onRow, state) {
  try {
    for await (const msg of client.fetch(ids, query, options)) {
      if (state.seen.has(msg.uid)) continue;
      state.seen.add(msg.uid);
      await onRow(msg);
    }
  } catch (err) {
    if (client.usable === false) throw err;
    if (ids.length <= 1) {
      state.skipped.push(...ids);
      return;
    }
    const half = Math.ceil(ids.length / 2);
    await fetchEach(client, ids.slice(0, half), query, options, onRow, state);
    await fetchEach(client, ids.slice(half), query, options, onRow, state);
  }
}

function reportSkipped(log, kind, skipped) {
  if (skipped.length === 0) return;
  const named = skipped.slice(0, MAX_SKIPPED_NAMED).join(", ");
  const more =
    skipped.length > MAX_SKIPPED_NAMED ? ` and ${skipped.length - MAX_SKIPPED_NAMED} more` : "";
  log(
    "warn",
    `skipped ${skipped.length} message(s) the server would not hand over (${kind} ${named}${more})`
  );
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

/** The plugin's criteria as an IMAP SEARCH query; distinct keys are ANDed. */
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
  const text = parsed.text?.trim() || htmlToText(parsed.html || "", maxTextChars);

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

/** How much HTML is worth reading for `maxTextChars` of text: tags and
 *  entities take room, a message is mostly them, and beyond a few times the
 *  limit nothing kept can come from it. */
export const HTML_TEXT_RATIO = 4;

/** Last-resort plain text for HTML-only mail. Deliberately crude: block-level
 *  tags become line breaks, everything else is dropped. Good enough to read in
 *  a note; anything richer belongs in a proper converter. */
export function htmlToText(html, maxTextChars) {
  return html
    .slice(0, HTML_TEXT_RATIO * maxTextChars)
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

/** How much of a server's own reason an error carries along. */
export const MAX_REFUSAL_CHARS = 300;

/**
 * An error message for a command imapflow gave up on quietly. It answers a
 * refused SEARCH with `false` and an unselected FETCH with nothing, logging the
 * reason instead of throwing it; read as "no matches", a refusal showed up as
 * an empty mailbox. The server's words are its own and go into a log and a
 * notice, so they are flattened to one line and bounded.
 */
export function refusalMessage(what, warnings) {
  const err = [...warnings].reverse().find((entry) => entry?.err)?.err;
  const reason = [err?.serverResponseCode, err?.response || err?.message]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REFUSAL_CHARS);
  return reason ? `${what}: ${reason}` : `${what}.`;
}

/**
 * `warnings`, when given, collects what imapflow logs at warn level and above:
 * the only place it leaves the reason for a command it answered with `false`.
 */
function newClient(config, warnings) {
  const keep = (entry) => {
    if (warnings) warnings.push(entry);
  };
  return new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: config.imap.auth,
    logger: { warn: keep, error: keep, fatal: keep },
    emitLogs: false,
    connectionTimeout: config.upstreamTimeoutMs,
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
  return `<${randomUUID()}@${senderDomain(from)}>`;
}

function joinAddresses(value) {
  if (!value) return undefined;
  const items = Array.isArray(value) ? value : [value];
  const joined = items
    .map((item) => String(item).trim())
    .filter(Boolean)
    .join(", ");
  return joined || undefined;
}
