/**
 * Schreibstube bridge.
 *
 * A stateless HTTP front end for the protocols an Obsidian plugin cannot speak.
 * Obsidian on mobile runs in a WebView with no Node runtime and no raw sockets,
 * so IMAP, SMTP and SFTP are out of reach; putting HTTPS in front of them gives
 * the plugin one transport (`requestUrl`) that behaves identically on desktop
 * and mobile.
 *
 * The bridge hosts capabilities, each with its own token, credentials and
 * limits. This file is only the plumbing: configuration, the route table, and
 * the order in which a request is checked. The capabilities are elsewhere.
 *
 * Nothing is persisted here: no database, no cache, no request-body logging.
 * The only long-lived state is the credentials held in the environment.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { capabilityNames, PROTOCOL_VERSION, loadConfig } from "./config.mjs";
import { clientAddress, newRequestId, parseJson, readBody, sendError, sendJson } from "./http.mjs";
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

let draining = false;
let inFlight = 0;

const server = createServer((req, res) => {
  const requestId = newRequestId();
  inFlight += 1;
  handle(req, res, requestId)
    .catch((err) => {
      log("error", `unhandled ${req.method} ${req.url}: ${err.stack ?? err.message}`, requestId);
      if (!res.headersSent) {
        sendError(res, 500, "internal_error", "Internal error.", requestId);
      }
    })
    .finally(() => {
      inFlight -= 1;
    });
});

server.listen(config.port, () => {
  log("info", `listening on :${config.port} — capabilities: ${capabilities.join(", ")}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => shutdown(signal));
}

async function handle(req, res, requestId) {
  // A redeploy should not cut a request in half. New work is refused while the
  // in-flight work finishes.
  if (draining) {
    return sendError(res, 503, "shutting_down", "Bridge is shutting down.", requestId);
  }

  const url = new URL(req.url ?? "/", "http://bridge");
  const pathname = url.pathname;
  const method = req.method ?? "GET";
  const address = clientAddress(req);
  const open = routes.some((route) => route.path === pathname && route.public);

  if (!open) {
    const gate = throttle.check(address);
    if (!gate.allowed) {
      log("warn", `throttled ${address}`, requestId);
      return sendError(res, 429, "too_many_failures", "Too many failed attempts.", requestId, {
        "retry-after": String(gate.retryAfterSeconds)
      });
    }
  }

  const capability = open ? null : authenticate(req.headers.authorization, tokens);
  const resolution = resolve(routes, { method, pathname, capability });

  switch (resolution.outcome) {
    case "unauthorized":
      // Deliberately identical for a missing token, a wrong one, and a valid
      // token reaching for another capability. None of them learns the path
      // even exists.
      throttle.recordFailure(address);
      return sendError(res, 401, "unauthorized", "Unauthorized.", requestId);
    case "not-found":
      return sendError(res, 404, "not_found", "Not found.", requestId);
    case "method-not-allowed":
      return sendError(res, 405, "method_not_allowed", "Method not allowed.", requestId);
    default:
      break;
  }

  if (!open) throttle.recordSuccess(address);

  const { route } = resolution;
  // Notes and images differ by three orders of magnitude, so a route says both
  // how much it will accept and whether it wants that parsed at all: base64 in
  // a JSON payload would inflate a video by a third on the way through memory.
  const bodyType = route.bodyType ?? (route.method === "GET" ? "none" : "json");
  let body;
  try {
    const raw = bodyType === "none" ? Buffer.alloc(0) : await readBody(req, route.maxBytes);
    body = bodyType === "json" ? parseJson(raw) : raw;
  } catch (err) {
    return fail(res, err, requestId);
  }

  try {
    const payload = await withDeadline(
      route.handler({
        body,
        query: url.searchParams,
        requestId,
        log: (level, message) => log(level, message, requestId)
      }),
      // A route may need longer than the default: uploading a video over a slow
      // line, or rendering and writing a whole site.
      route.timeoutMs ?? config.requestTimeoutMs,
      "Request"
    );
    return sendJson(res, 200, payload);
  } catch (err) {
    return fail(res, err, requestId);
  }
}

function fail(res, err, requestId) {
  if (err instanceof TimeoutError) {
    log("error", err.message, requestId);
    return sendError(res, 504, "timeout", "The request took too long.", requestId);
  }
  if (err.status) {
    if (err.status >= 500) log("error", err.message, requestId);
    return sendError(res, err.status, err.code, err.message, requestId);
  }
  throw err;
}

/**
 * The only unauthenticated route, so a platform health check can reach it. The
 * version pair is what lets the plugin notice that a bridge was not redeployed
 * alongside it, rather than failing later on an unknown route.
 */
function healthRoute() {
  return {
    method: "GET",
    path: "/health",
    public: true,
    maxBytes: 0,
    bodyType: "none",
    handler: async () => ({
      status: "ok",
      version: VERSION,
      protocol: PROTOCOL_VERSION,
      capabilities
    })
  };
}

async function shutdown(signal) {
  if (draining) return;
  draining = true;
  log("info", `${signal} received, draining ${inFlight} request(s)`);

  server.close();
  server.closeIdleConnections?.();

  const until = Date.now() + config.drainTimeoutMs;
  while (inFlight > 0 && Date.now() < until) {
    await new Promise((done) => setTimeout(done, 50));
  }

  if (inFlight > 0) {
    log("warn", `exiting with ${inFlight} request(s) still in flight`);
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
