/**
 * HTTP plumbing shared by every route: request identity, body reading within a
 * per-route limit, and the two response shapes.
 */
import { randomBytes } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

export function newRequestId() {
  return `req_${randomBytes(4).toString("hex")}`;
}

/**
 * The address the authentication throttle keys on.
 *
 * Behind a reverse proxy — which is every hosting platform that terminates
 * TLS — the socket belongs to the proxy, and every caller in the world shares
 * that one address. The throttle would then lock the real user out after a
 * stranger's five bad guesses. With `TRUST_PROXY` set, the address is read from
 * the last hop of `X-Forwarded-For`: the one the trusted proxy appended, which
 * a client cannot forge. Earlier hops are whatever the client claimed.
 *
 * Off by default, because trusting the header without a proxy in front lets
 * anyone pick the address they are throttled as.
 *
 * `hops` is how many proxies stand in front, each appending the address it
 * was reached from: with a CDN before the platform's proxy the caller is the
 * second address from the right, and the last is the CDN's. A chain shorter
 * than that was appended by trusted proxies alone, so its first entry is the
 * caller. `trustProxy: true` with no `hops` is one proxy, as it always was.
 */
export function clientAddress(req, { trustProxy = false, hops = trustProxy ? 1 : 0 } = {}) {
  if (hops > 0) {
    const chain = forwardedChain(req);
    if (chain.length > 0) return chain[Math.max(0, chain.length - hops)];
  }
  return req.socket?.remoteAddress ?? "unknown";
}

/** Whether the request names a forwarded address at all, trusted or not. */
export function hasForwardedFor(req) {
  return forwardedChain(req).length > 0;
}

function forwardedChain(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  return (Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? ""))
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
}

/** Longest throttle key kept. An address is at most 45 characters; anything
 *  longer came from a header and is the sender's to inflate. */
export const MAX_THROTTLE_KEY_CHARS = 64;

/**
 * The key an address is throttled under.
 *
 * One IPv6 customer is given a /64 at the least, and every address in it is
 * theirs to send from: keyed per address, a stranger had 2^64 fresh sets of
 * guesses. So an IPv6 address counts as its /64, and an IPv4 address that
 * arrives in IPv6 clothing (`::ffff:192.0.2.1`, as a dual-stack socket reports
 * it) as the IPv4 address it is. What is neither — a forwarded value that is
 * not an address — is kept as text, cut to a bound.
 */
export function throttleKey(address) {
  const text = String(address ?? "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  if (isIPv4(text)) return text;
  if (isIPv6(text)) {
    const groups = expandIPv6(text);
    if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
      return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    }
    return `${groups
      .slice(0, 4)
      .map((group) => group.toString(16))
      .join(":")}::/64`;
  }
  return text.slice(0, MAX_THROTTLE_KEY_CHARS) || "unknown";
}

/** An IPv6 address as its eight groups, `::` and a dotted IPv4 tail expanded. */
function expandIPv6(text) {
  let body = text;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(body);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    body = `${body.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = body.includes("::") ? body.split("::") : [body, null];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = tail === null ? 0 : 8 - left.length - right.length;
  return [...left, ...Array(missing).fill("0"), ...right].map((group) => parseInt(group, 16));
}

/**
 * Read a request body, refusing anything over the route's limit.
 *
 * The limit is checked twice: once against the declared length, which is the
 * path a normal client takes and costs nothing, and once while reading, for a
 * client that declares no length at all. The second case pauses rather than
 * destroys the socket — destroying it kills the connection before the 413 can
 * be written, so the client sees an opaque reset instead of the reason.
 *
 * A limit that is not a number is a route without one, which is a bug here,
 * not a large request: `size > undefined` is never true, and the body would
 * be read whole.
 */
export function readBody(req, maxBytes) {
  if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes)) {
    throw new TypeError(`readBody needs a finite byte limit, not ${String(maxBytes)}.`);
  }
  return new Promise((resolve, reject) => {
    const declared = Number.parseInt(req.headers["content-length"] ?? "", 10);
    if (Number.isInteger(declared) && declared > maxBytes) {
      reject(httpError(413, "body_too_large", `Request body exceeds ${maxBytes} bytes.`));
      return;
    }

    const chunks = [];
    let size = 0;
    let rejected = false;

    req.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        req.pause();
        reject(httpError(413, "body_too_large", `Request body exceeds ${maxBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });

    req.on("error", (err) => {
      if (!rejected) reject(httpError(400, "body_unreadable", err.message));
    });
  });
}

/** An empty body is an empty object; anything that is not an object is
 *  refused in one place rather than tripping a field check further in. */
export function parseJson(buffer) {
  const raw = buffer.toString("utf8");
  if (!raw.trim()) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw httpError(400, "invalid_json", "Request body is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw httpError(400, "invalid_request", "Request body must be a JSON object.");
  }
  return parsed;
}

/**
 * An error with a status the client sees, and optionally a detail it does not.
 *
 * `detail` is for what the operator needs and the caller must not be told —
 * a remote path, a library's own wording. It is logged with the request id and
 * never sent.
 */
export function httpError(status, code, message, detail) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (detail !== undefined) err.detail = detail;
  return err;
}

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

/**
 * Errors carry a stable code and the request id alongside the message, so a
 * report can be tied to a log line without the operator reading the logs to the
 * user. The message stays human; anything the message should not carry is the
 * handler's job to leave out.
 */
export function sendError(res, status, code, message, requestId, headers = {}) {
  sendJson(res, status, { error: message, code, requestId }, headers);
}
