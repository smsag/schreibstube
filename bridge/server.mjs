/**
 * Schreibstube mail bridge.
 *
 * A stateless HTTP front end for one IMAP/SMTP mailbox. It exists because
 * Obsidian on mobile runs in a WebView with no Node runtime and no raw
 * sockets, so the plugin cannot speak IMAP or SMTP itself. Putting HTTPS in
 * front of them gives the plugin a single transport (`requestUrl`) that behaves
 * identically on desktop and mobile.
 *
 * Nothing is persisted: no database, no message cache, no request-body logging.
 * The only long-lived state is the mailbox credential held in the environment.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config.mjs";
import { createSmtpTransport, searchMessages, sendMessage } from "./mail.mjs";

const config = loadConfig();
const smtp = createSmtpTransport(config);

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    log("error", `unhandled ${req.method} ${req.url}: ${err.message}`);
    send(res, 500, { error: "Internal error." });
  });
});

server.listen(config.port, () => {
  log("info", `listening on :${config.port} (imap ${config.imap.host}, smtp ${config.smtp.host})`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log("info", `${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}

async function handle(req, res) {
  const path = new URL(req.url ?? "/", "http://bridge").pathname;

  // Unauthenticated so the platform health check can reach it. It reveals
  // nothing beyond the fact that a bridge is running.
  if (req.method === "GET" && path === "/health") {
    return send(res, 200, { status: "ok" });
  }

  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed." });
  }

  if (!isAuthorized(req)) {
    // Deliberately identical for a missing and a wrong token.
    return send(res, 401, { error: "Unauthorized." });
  }

  let body;
  try {
    body = await readJson(req, config.maxBodyBytes);
  } catch (err) {
    return send(res, err.statusCode ?? 400, { error: err.message });
  }

  switch (path) {
    case "/send":
      return await handleSend(res, body);
    case "/search":
      return await handleSearch(res, body);
    default:
      return send(res, 404, { error: "Not found." });
  }
}

async function handleSend(res, body) {
  const problem = validateSend(body);
  if (problem) {
    return send(res, 400, { error: problem });
  }

  try {
    const result = await sendMessage(config, smtp, body);
    // Recipients are intentionally absent from the log line.
    log("info", `sent ${result.messageId} (filed in sent: ${result.filedInSent})`);
    return send(res, 200, result);
  } catch (err) {
    log("error", `send failed: ${err.message}`);
    return send(res, 502, { error: `Send failed: ${err.message}` });
  }
}

async function handleSearch(res, body) {
  try {
    const result = await searchMessages(config, body ?? {});
    log("info", `search returned ${result.messages.length} message(s) from ${result.mailbox}`);
    return send(res, 200, result);
  } catch (err) {
    log("error", `search failed: ${err.message}`);
    return send(res, 502, { error: `Search failed: ${err.message}` });
  }
}

function validateSend(body) {
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
  if (body.text.length > config.maxTextChars) {
    return `Body exceeds the ${config.maxTextChars} character limit.`;
  }
  return null;
}

function hasRecipient(value) {
  if (Array.isArray(value)) {
    return value.some((item) => String(item).trim().length > 0);
  }
  return typeof value === "string" && value.trim().length > 0;
}

function isAuthorized(req) {
  const header = req.headers.authorization ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return false;
  }
  const presented = Buffer.from(header.slice(prefix.length).trim());
  const expected = Buffer.from(config.token);
  // timingSafeEqual throws on a length mismatch, so compare lengths first —
  // that leaks only the token length, not its content.
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(fail(413, `Request body exceeds ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(fail(400, "Request body is not valid JSON."));
      }
    });

    req.on("error", (err) => reject(fail(400, err.message)));
  });
}

function fail(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function send(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function log(level, message) {
  const line = `[bridge] ${new Date().toISOString()} ${level} ${message}`;
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
