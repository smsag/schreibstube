/**
 * Schreibstube bridge: the plumbing only — configuration, the route table,
 * and the order in which a request is checked. The capabilities are elsewhere.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { capabilityNames, PROTOCOL_VERSION, loadConfig } from "./config.mjs";
import {
  clientAddress,
  hasForwardedFor,
  newRequestId,
  parseJson,
  readBody,
  sendError,
  sendJson,
  throttleKey
} from "./http.mjs";
import { authenticate, resolve } from "./router.mjs";
import { createThrottle } from "./throttle.mjs";
import { TimeoutError, withDeadline } from "./timeout.mjs";
import { createMailRoutes } from "./mail-routes.mjs";
import { createPublishRoutes } from "./publish/routes.mjs";

const VERSION = createRequire(import.meta.url)("./package.json").version;

const config = loadConfig();
const capabilities = capabilityNames(config);
const tokens = Object.fromEntries(capabilities.map((name) => [name, config[name].token]));
const routes = [
  healthRoute(),
  ...(config.mail ? createMailRoutes(config) : []),
  ...(config.publish ? createPublishRoutes(config, { version: VERSION }) : [])
];
const throttle = createThrottle({
  limit: config.authFailureLimit,
  windowMs: config.authFailureWindowMs
});

/** How long the headers of a request may take to arrive. */
const HEADERS_TIMEOUT_MS = 10_000;

let draining = false;
/** Whether the log has said that X-Forwarded-For arrives untrusted; once is
 *  advice, every request would be noise. */
let warnedForwarded = false;
/** Requests being answered, and handlers still running after a 504: the
 *  shutdown waits for both, since the second may be halfway through a write. */
const inFlight = new Set();

function track(promise) {
  inFlight.add(promise);
  promise.then(
    () => inFlight.delete(promise),
    () => inFlight.delete(promise)
  );
  return promise;
}

const server = createServer((req, res) => {
  const requestId = newRequestId();
  track(
    handle(req, res, requestId).catch((err) => {
      log("error", `unhandled ${req.method} ${req.url}: ${err.stack ?? err.message}`, requestId);
      if (!res.headersSent) {
        sendError(res, 500, "internal_error", "Internal error.", requestId);
      }
    })
  );
});

// Node's own limits on receiving a request, behind the route deadlines: the
// headers within a few seconds, the whole request within the longest route's,
// so a client that trickles bytes is cut off by one or the other rather than
// holding a socket for as long as it likes. The headers are a few hundred
// bytes from a client that means it; the route budgets are for bodies.
// A refused request is closed as soon as it is answered (see `refuse`), so
// the longest budget is spent only by a caller holding a token.
const longestRouteMs = Math.max(
  config.requestTimeoutMs,
  ...routes.map((route) => route.timeoutMs ?? 0)
);
server.headersTimeout = Math.min(HEADERS_TIMEOUT_MS, config.requestTimeoutMs);
server.requestTimeout = longestRouteMs + 5_000;
server.maxConnections = config.maxConnections;

server.listen(config.port, () => {
  log("info", `listening on :${config.port} — capabilities: ${capabilities.join(", ")}`);
  // Said at every start for the same reason: the default is right for one
  // person's site and wrong for a shared vault, and only the operator knows
  // which this is.
  for (const target of Object.values(config.publish?.targets ?? {})) {
    if (target.allowHtml) {
      log(
        "warn",
        `publish target ${target.name}: raw HTML from notes is published as written; ` +
          `a vault with more than one author should set ` +
          `PUBLISH_${target.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_ALLOW_HTML=false.`
      );
    }
  }
  // Said at every start rather than once in a README: the state directory
  // holds every note as written, and a server that ignores .htaccess serves it.
  for (const target of Object.values(config.publish?.targets ?? {})) {
    if (target.stateInsideRoot) {
      log(
        "warn",
        `publish target ${target.name}: state directory lies inside the web root; ` +
          `the bridge writes a deny .htaccess there, and any server that ignores one ` +
          `needs a rule denying ${target.stateRoot.slice(target.root.length) || "/"} — ` +
          `or set PUBLISH_${target.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_STATE_ROOT outside it.`
      );
    }
  }
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => shutdown(signal));
}

async function handle(req, res, requestId) {
  // A redeploy should not cut a request in half. New work is refused while the
  // in-flight work finishes.
  if (draining) {
    return refuse(req, res, 503, "shutting_down", "Bridge is shutting down.", requestId);
  }

  // A target the URL parser cannot read (`//[`) is the caller's mistake, and
  // was answered as an internal error with a stack trace in the log.
  let url;
  try {
    url = new URL(req.url ?? "/", "http://bridge");
  } catch {
    return refuse(req, res, 400, "invalid_url", "The request URL cannot be read.", requestId);
  }
  const pathname = url.pathname;
  const method = req.method ?? "GET";
  const address = throttleKey(clientAddress(req, { hops: config.trustProxyHops }));
  const open = routes.some((route) => route.path === pathname && route.public);

  if (!warnedForwarded && config.trustProxyHops === 0 && hasForwardedFor(req)) {
    warnedForwarded = true;
    log(
      "warn",
      "a request carried X-Forwarded-For while TRUST_PROXY is off: if a proxy stands in " +
        "front, every caller is throttled as its address — set TRUST_PROXY=true. " +
        "Said once per start."
    );
  }

  let capability = null;
  if (open) {
    // A token on an open route asks for more of its answer, and is a guess
    // like any other: counted when wrong, and not even tried while the
    // address is throttled. The route itself still answers, since a
    // platform's probe must reach it whatever a stranger did.
    if (req.headers.authorization !== undefined && throttle.check(address).allowed) {
      capability = authenticate(req.headers.authorization, tokens);
      if (!capability) throttle.recordFailure(address);
    }
  } else {
    const gate = throttle.check(address);
    if (!gate.allowed) {
      log("warn", `throttled ${address}`, requestId);
      return refuse(req, res, 429, "too_many_failures", "Too many failed attempts.", requestId, {
        "retry-after": String(gate.retryAfterSeconds)
      });
    }
    capability = authenticate(req.headers.authorization, tokens);
  }

  const resolution = resolve(routes, { method, pathname, capability });

  switch (resolution.outcome) {
    case "unauthorized":
      throttle.recordFailure(address);
      return refuse(req, res, 401, "unauthorized", "Unauthorized.", requestId);
    case "not-found":
      return refuse(req, res, 404, "not_found", "Not found.", requestId);
    case "method-not-allowed":
      return refuse(req, res, 405, "method_not_allowed", "Method not allowed.", requestId);
    default:
      break;
  }

  const { route } = resolution;
  // Notes and images differ by three orders of magnitude, so a route says both
  // how much it will accept and whether it wants that parsed at all: base64 in
  // a JSON payload would inflate a video by a third on the way through memory.
  const bodyType = route.bodyType ?? (route.method === "GET" ? "none" : "json");
  const maxBytes =
    typeof route.maxBytes === "function" ? route.maxBytes(url.searchParams) : route.maxBytes;

  // One deadline over reading the body and answering it: a client that sends
  // its body a byte at a time used to be outside every budget, and a handler
  // that outlives the deadline is still counted until it settles.
  const work = async () => {
    const raw = bodyType === "none" ? Buffer.alloc(0) : await readBody(req, maxBytes);
    const body = bodyType === "json" ? parseJson(raw) : raw;
    return track(
      route.handler({
        body,
        query: url.searchParams,
        requestId,
        capability,
        log: (level, message) => log(level, message, requestId)
      })
    );
  };

  try {
    const payload = await withDeadline(
      work(),
      route.timeoutMs ?? config.requestTimeoutMs,
      "Request"
    );
    return sendJson(res, 200, payload);
  } catch (err) {
    return fail(req, res, err, requestId);
  }
}

function fail(req, res, err, requestId) {
  if (err instanceof TimeoutError) {
    log("error", err.message, requestId);
    return refuse(req, res, 504, "timeout", "The request took too long.", requestId);
  }
  if (err.status) {
    if (err.status >= 500) log("error", err.detail ?? err.message, requestId);
    return refuse(req, res, err.status, err.code, err.message, requestId, err.headers);
  }
  throw err;
}

/**
 * An error answer, and the end of the connection when the request's body has
 * not arrived. A client refused before its body was read could otherwise keep
 * sending it, or keep the socket open with a body it never sends, for the
 * longest route's budget — five minutes per socket, from anyone without a
 * token. `connection: close` tells the client; the socket is destroyed once
 * the answer is out, whatever the client does next.
 */
function refuse(req, res, status, code, message, requestId, headers = {}) {
  // `complete` alone is not the answer: a request without a body is answered
  // before Node has marked it complete, and closing it would cost the
  // plugin's next call a new TLS handshake for nothing.
  const announced = req.headers["transfer-encoding"] !== undefined;
  const length = Number.parseInt(req.headers["content-length"] ?? "0", 10);
  if (req.complete || (!announced && !(length > 0))) {
    return sendError(res, status, code, message, requestId, headers);
  }
  res.once("finish", () => req.destroy());
  return sendError(res, status, code, message, requestId, { ...headers, connection: "close" });
}

/**
 * What a deployment is. `status` is for a platform's probe and `protocol` for
 * the plugin's handshake, both before any token is set; the version and the
 * capabilities tell a scanner which advisories apply and what is worth
 * guessing a token for, so only a caller holding one hears them.
 */
function healthRoute() {
  return {
    method: "GET",
    path: "/health",
    public: true,
    maxBytes: 0,
    bodyType: "none",
    handler: async ({ capability }) =>
      capability
        ? { status: "ok", version: VERSION, protocol: PROTOCOL_VERSION, capabilities }
        : { status: "ok", protocol: PROTOCOL_VERSION }
  };
}

async function shutdown(signal) {
  if (draining) return;
  draining = true;
  log("info", `${signal} received, draining ${inFlight.size} task(s)`);

  server.close();
  server.closeIdleConnections?.();

  const until = Date.now() + config.drainTimeoutMs;
  while (inFlight.size > 0 && Date.now() < until) {
    await new Promise((done) => setTimeout(done, 50));
  }

  if (inFlight.size > 0) {
    log("warn", `exiting with ${inFlight.size} request(s) still in flight`);
  }
  process.exit(0);
}

/**
 * One line per event, in whichever shape the deployment can read.
 *
 * Text is the default because a person is usually reading it. JSON is there for
 * a hosting dashboard, where "every line about req_3f9a1c07" is a query rather
 * than a search through prose.
 */
function log(level, message, requestId) {
  const line =
    config.logFormat === "json"
      ? JSON.stringify({ time: new Date().toISOString(), level, requestId, message })
      : `[bridge] ${new Date().toISOString()} ${level} ${requestId ? `${requestId} ` : ""}${message}`;

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
