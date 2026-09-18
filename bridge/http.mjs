/**
 * HTTP plumbing shared by every route: request identity, body reading within a
 * per-route limit, and the two response shapes.
 */
import { randomBytes } from "node:crypto";

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
 */
export function clientAddress(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const forwarded = req.headers?.["x-forwarded-for"];
    const chain = (Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? ""))
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (chain.length > 0) return chain[chain.length - 1];
  }
  return req.socket?.remoteAddress ?? "unknown";
}

/**
 * Read a request body, refusing anything over the route's limit.
 *
 * The limit is checked twice: once against the declared length, which is the
 * path a normal client takes and costs nothing, and once while reading, for a
 * client that declares no length at all. The second case pauses rather than
 * destroys the socket — destroying it kills the connection before the 413 can
 * be written, so the client sees an opaque reset instead of the reason.
 */
export function readBody(req, maxBytes) {
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

/**
 * An empty body is an empty object: several endpoints take only defaults.
 *
 * Every JSON route here takes an object, so anything else — an array, a bare
 * string, null — is refused in one place rather than tripping a field check
 * further in and being reported as a missing field.
 */
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
