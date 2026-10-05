import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";

/**
 * Tests for the HTTP layer.
 *
 * The bridge is started as a real process and driven over real HTTP, because
 * `server.mjs` reads its configuration and binds its port at import time. That
 * is also the honest test: routing, auth, the throttle and the body limits are
 * properties of the running service rather than of any one module.
 *
 * IMAP and SMTP point at a closed port, so anything that reaches the protocols
 * fails immediately and the failure path is exercised rather than skipped.
 */

const SERVER = fileURLToPath(new URL("./server.mjs", import.meta.url));
const TOKEN = "t0k3n-for-the-bridge-under-test";
const MAX_BODY_BYTES = 2000;
const MAX_TEXT_CHARS = 100;

const running = [];
/** What each started bridge has logged so far, by its URL. */
const logs = new Map();
let base;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function environment(overrides = {}) {
  return {
    ...process.env,
    MAIL_TOKEN: TOKEN,
    IMAP_HOST: "127.0.0.1",
    IMAP_PORT: "1",
    IMAP_SECURE: "false",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1",
    SMTP_SECURE: "false",
    MAIL_USER: "post@example.com",
    MAIL_PASSWORD: "geheim",
    MAIL_FROM: "Schreibstube <post@example.com>",
    SENT_MAILBOX: "",
    MAX_BODY_BYTES: String(MAX_BODY_BYTES),
    MAX_TEXT_CHARS: String(MAX_TEXT_CHARS),
    UPSTREAM_TIMEOUT_MS: "2000",
    // High enough that the rejections these tests provoke never trip it; the
    // throttle gets an instance of its own.
    AUTH_FAILURE_LIMIT: "1000",
    ...overrides
  };
}

/** Start a bridge on a free port and wait until it answers. */
async function start(overrides = {}) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [SERVER], {
    env: environment({ PORT: String(port), ...overrides }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  running.push(child);
  logs.set(url, "");
  child.stdout.on("data", (chunk) => {
    logs.set(url, logs.get(url) + chunk);
  });

  const until = Date.now() + 10_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/health`)).ok) return url;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) throw new Error("bridge did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function call(
  path,
  { method = "POST", token = TOKEN, body, at = undefined, headers = {} } = {}
) {
  const response = await fetch(`${at ?? base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers
    },
    body: typeof body === "string" || body === undefined ? body : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text,
    json: text ? JSON.parse(text) : null
  };
}

/** A body sent in chunks, so no Content-Length announces the size up front. */
function streamed(path, chunks) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${base}${path}`);
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, text }));
      }
    );
    req.on("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

/**
 * Bytes written straight to the socket, for what `fetch` will not send, and
 * everything that comes back until the bridge ends the connection.
 */
function raw(at, bytes) {
  return new Promise((resolve, reject) => {
    const url = new URL(at);
    const socket = connect(Number(url.port), url.hostname);
    let text = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      text += chunk;
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(text));
    socket.setTimeout(10_000, () => socket.destroy(new Error("the bridge kept the socket open")));
    socket.write(bytes);
  });
}

const valid = { to: "kunde@example.com", subject: "Angebot", text: "Guten Tag" };

beforeAll(async () => {
  base = await start();
}, 20_000);

afterAll(() => {
  for (const child of running) child.kill("SIGKILL");
});

describe("health", () => {
  it("answers without a token, so a platform probe can reach it", async () => {
    const response = await call("/health", { method: "GET", token: null });
    expect(response.status).toBe(200);
    expect(response.json.status).toBe("ok");
  });

  it("reports the protocol the plugin compares against to anyone, and nothing more", async () => {
    const { json } = await call("/health", { method: "GET", token: null });
    expect(json).toEqual({ status: "ok", protocol: expect.any(Number) });
    expect(json.protocol).toBeGreaterThan(0);
  });

  it("names its version and capabilities only to a caller holding a token", async () => {
    const { json } = await call("/health", { method: "GET" });
    expect(json.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(json.capabilities).toEqual(["mail"]);
  });

  it("answers a wrong token with the public shape, not with a refusal", async () => {
    const response = await call("/health", { method: "GET", token: "f".repeat(32) });
    expect(response.status).toBe(200);
    expect(response.json.version).toBeUndefined();
    expect(response.json.capabilities).toBeUndefined();
  });

  it("answers JSON that must not be cached", async () => {
    const response = await call("/health", { method: "GET", token: null });
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("routing", () => {
  it("refuses another method on a route the caller may use", async () => {
    const response = await call("/send", { method: "GET" });
    expect(response.status).toBe(405);
    expect(response.json.code).toBe("method_not_allowed");
  });

  it("reports an unknown path, but only to a caller who is authorised", async () => {
    const response = await call("/gibtesnicht", { body: {} });
    expect(response.status).toBe(404);
  });

  it("checks the token before the path, so an unknown path leaks nothing", async () => {
    const response = await call("/gibtesnicht", { token: null, body: {} });
    expect(response.status).toBe(401);
  });

  it("checks the token before the method, so a probe learns nothing either", async () => {
    const response = await call("/send", { method: "GET", token: null });
    expect(response.status).toBe(401);
  });
});

describe("authorisation", () => {
  it("rejects a missing token", async () => {
    const response = await call("/send", { token: null, body: valid });
    expect(response.status).toBe(401);
    expect(response.json.error).toBe("Unauthorized.");
  });

  it("rejects a wrong token identically, revealing nothing about which it was", async () => {
    const missing = await call("/send", { token: null, body: valid });
    const wrong = await call("/send", { token: "f".repeat(32), body: valid });
    expect(wrong.status).toBe(missing.status);
    expect(wrong.json.error).toBe(missing.json.error);
    expect(wrong.json.code).toBe(missing.json.code);
  });

  it("rejects a token of a different length", async () => {
    const response = await call("/send", { token: "kurz", body: valid });
    expect(response.status).toBe(401);
  });

  it("rejects a token without the Bearer prefix", async () => {
    const response = await fetch(`${base}/send`, {
      method: "POST",
      headers: { authorization: TOKEN },
      body: JSON.stringify(valid)
    });
    expect(response.status).toBe(401);
  });

  it("tolerates whitespace around the token", async () => {
    const response = await fetch(`${base}/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}  `, "content-type": "application/json" },
      body: JSON.stringify(valid)
    });
    expect(response.status).not.toBe(401);
  });
});

describe("errors", () => {
  it("carries a stable code and a request id, so a report ties to a log line", async () => {
    const response = await call("/send", { body: { subject: "S", text: "T" } });
    expect(response.json.code).toBe("invalid_request");
    expect(response.json.requestId).toMatch(/^req_[0-9a-f]{8}$/);
  });

  it("refuses a from that is not one address rather than sending as MAIL_FROM", async () => {
    const response = await call("/send", { body: { ...valid, from: "Steffen Seitz" } });
    expect(response.status).toBe(400);
    expect(response.json.code).toBe("invalid_request");
  });

  it("refuses a from that is not a string", async () => {
    const response = await call("/send", { body: { ...valid, from: ["a@example.com"] } });
    expect(response.status).toBe(400);
  });

  it("gives every request its own id", async () => {
    const first = await call("/send", { token: null });
    const second = await call("/send", { token: null });
    expect(first.json.requestId).not.toBe(second.json.requestId);
  });
});

// /search rather than /send: the send route alone reads a larger body, room
// for the pictures of a note, and has its own test in mail-routes.
describe("request bodies", () => {
  it("rejects an announced body over the limit", async () => {
    const response = await call("/search", {
      body: { criteria: { subject: "x".repeat(MAX_BODY_BYTES) } }
    });
    expect(response.status).toBe(413);
    expect(response.json.error).toContain(String(MAX_BODY_BYTES));
    expect(response.json.code).toBe("body_too_large");
  });

  it("rejects an oversized body that announced no length, with the reason rather than a reset", async () => {
    const response = await streamed("/search", ['{"text":"', "x".repeat(MAX_BODY_BYTES), '"}']);
    expect(response.status).toBe(413);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await call("/send", { body: "{kein json" });
    expect(response.status).toBe(400);
    expect(response.json.code).toBe("invalid_json");
  });

  it("treats an empty body as an empty object", async () => {
    const response = await call("/search", { body: "" });
    expect(response.status).toBe(502);
  });
});

describe("send validation", () => {
  async function reject(body) {
    const response = await call("/send", { body });
    expect(response.status).toBe(400);
    return response.json.error;
  }

  it("requires at least one recipient", async () => {
    expect(await reject({ subject: "Angebot", text: "Guten Tag" })).toContain("recipient");
  });

  it("accepts a recipient in cc or bcc alone", async () => {
    const response = await call("/send", {
      body: { bcc: ["a@example.com"], subject: "S", text: "T" }
    });
    expect(response.status).toBe(502);
  });

  it("ignores blank recipients", async () => {
    expect(await reject({ to: ["  ", ""], subject: "S", text: "T" })).toContain("recipient");
  });

  it("requires a non-empty subject", async () => {
    expect(await reject({ ...valid, subject: "   " })).toContain("subject");
  });

  it("requires a non-empty text body", async () => {
    expect(await reject({ ...valid, text: "" })).toContain("text body");
  });

  it("rejects a body over the character limit, naming the limit", async () => {
    expect(await reject({ ...valid, text: "x".repeat(MAX_TEXT_CHARS + 1) })).toContain(
      String(MAX_TEXT_CHARS)
    );
  });

  it("rejects a body that is not an object at all", async () => {
    expect(await reject("null")).toContain("JSON object");
    expect(await reject("[]")).toContain("JSON object");
    expect(await reject('"text"')).toContain("JSON object");
  });
});

describe("upstream failures", () => {
  it("reports an unreachable SMTP server as a bad gateway", async () => {
    const response = await call("/send", { body: valid });
    expect(response.status).toBe(502);
    expect(response.json.error).toMatch(/^Send failed: /);
    expect(response.json.code).toBe("upstream_error");
  });

  it("reports an unreachable IMAP server as a bad gateway", async () => {
    const response = await call("/search", { body: {} });
    expect(response.status).toBe(502);
    expect(response.json.error).toMatch(/^Search failed: /);
  });
});

describe("deadlines", () => {
  it("counts the body's arrival against the route's budget, so a trickling client gets a 504", async () => {
    const slow = await start({ REQUEST_TIMEOUT_MS: "300" });
    const url = new URL(`${slow}/search`);
    const answered = new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            "content-length": "20"
          }
        },
        (res) => {
          let text = "";
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
        }
      );
      req.on("error", reject);
      // Half the body, and then nothing.
      req.write('{"criteria":');
    });
    const response = await answered;
    expect(response.status).toBe(504);
    expect(response.json.code).toBe("timeout");
  }, 10_000);
});

describe("diagnostics", () => {
  it("reports each protocol separately rather than failing the request", async () => {
    const response = await call("/diagnostics", { body: {} });
    expect(response.status).toBe(200);
    expect(response.json.imap.ok).toBe(false);
    expect(response.json.smtp.ok).toBe(false);
  });

  it("says what went wrong per protocol", async () => {
    const { json } = await call("/diagnostics", { body: {} });
    expect(json.imap.error).toBeTruthy();
  });

  it("needs a token, unlike the health probe", async () => {
    const response = await call("/diagnostics", { token: null, body: {} });
    expect(response.status).toBe(401);
  });
});

describe("throttle", () => {
  let throttled;

  beforeAll(async () => {
    throttled = await start({ AUTH_FAILURE_LIMIT: "2", AUTH_FAILURE_WINDOW_MS: "60000" });
  }, 20_000);

  it("blocks an address after repeated failures, and says how long for", async () => {
    await call("/send", { token: null, at: throttled });
    await call("/send", { token: null, at: throttled });

    const blocked = await call("/send", { token: null, at: throttled });
    expect(blocked.status).toBe(429);
    expect(blocked.json.code).toBe("too_many_failures");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("blocks a valid token from the same address too, since the address is what is blocked", async () => {
    const response = await call("/send", { body: valid, at: throttled });
    expect(response.status).toBe(429);
  });

  it("leaves the health probe reachable, so the platform does not kill the container", async () => {
    const response = await call("/health", { method: "GET", token: null, at: throttled });
    expect(response.status).toBe(200);
  });

  it("does not try a token at the health probe while the address is throttled", async () => {
    const response = await call("/health", { method: "GET", at: throttled });
    expect(response.status).toBe(200);
    expect(response.json.version).toBeUndefined();
  });

  it("counts a wrong token at the health probe, so it is no oracle for guessing", async () => {
    const guessed = await start({ AUTH_FAILURE_LIMIT: "2", AUTH_FAILURE_WINDOW_MS: "60000" });
    await call("/health", { method: "GET", token: "f".repeat(32), at: guessed });
    await call("/health", { method: "GET", token: "g".repeat(32), at: guessed });
    expect((await call("/send", { body: valid, at: guessed })).status).toBe(429);
  }, 20_000);

  it("is not reset by a good token, so holding one buys no guesses at another", async () => {
    const shared = await start({ AUTH_FAILURE_LIMIT: "2", AUTH_FAILURE_WINDOW_MS: "60000" });
    await call("/send", { token: "f".repeat(32), at: shared });
    expect((await call("/search", { body: {}, at: shared })).status).not.toBe(429);
    await call("/send", { token: "f".repeat(32), at: shared });
    expect((await call("/search", { body: {}, at: shared })).status).toBe(429);
  }, 20_000);
});

describe("throttle behind a proxy", () => {
  it("keys on the socket and ignores X-Forwarded-For by default, so a client cannot pick its own address", async () => {
    const direct = await start({ AUTH_FAILURE_LIMIT: "2", AUTH_FAILURE_WINDOW_MS: "60000" });
    for (const claimed of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) {
      await call("/send", { token: null, at: direct, headers: { "x-forwarded-for": claimed } });
    }
    const blocked = await call("/send", { token: null, at: direct });
    expect(blocked.status).toBe(429);

    // Said once, since a proxy nobody told the bridge about is a setting to fix.
    const said = logs
      .get(direct)
      .split("\n")
      .filter((line) => line.includes("X-Forwarded-For"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("TRUST_PROXY=true");
  }, 20_000);

  it("keys on the last forwarded hop when TRUST_PROXY is set, so one stranger cannot lock everyone out", async () => {
    const proxied = await start({
      AUTH_FAILURE_LIMIT: "2",
      AUTH_FAILURE_WINDOW_MS: "60000",
      TRUST_PROXY: "true"
    });
    const stranger = { "x-forwarded-for": "203.0.113.9" };
    await call("/send", { token: null, at: proxied, headers: stranger });
    await call("/send", { token: null, at: proxied, headers: stranger });
    expect((await call("/send", { token: null, at: proxied, headers: stranger })).status).toBe(429);

    // The real user arrives through the same proxy from another address. A
    // spoofed first hop changes nothing: only the hop the proxy appended counts.
    const user = { "x-forwarded-for": "203.0.113.9, 198.51.100.4" };
    const response = await call("/send", { body: valid, at: proxied, headers: user });
    expect(response.status).not.toBe(429);
  }, 20_000);

  it("keys on the hop TRUST_PROXY_HOPS names, behind a CDN and a platform's proxy", async () => {
    const proxied = await start({
      AUTH_FAILURE_LIMIT: "2",
      AUTH_FAILURE_WINDOW_MS: "60000",
      TRUST_PROXY_HOPS: "2"
    });
    // The last hop is the CDN's, the same for every caller.
    const stranger = { "x-forwarded-for": "203.0.113.9, 192.0.2.50" };
    await call("/send", { token: null, at: proxied, headers: stranger });
    await call("/send", { token: null, at: proxied, headers: stranger });
    expect((await call("/send", { token: null, at: proxied, headers: stranger })).status).toBe(429);

    const user = { "x-forwarded-for": "198.51.100.4, 192.0.2.50" };
    expect((await call("/send", { body: valid, at: proxied, headers: user })).status).not.toBe(429);
  }, 20_000);

  it("throttles a whole IPv6 /64 as one caller, since one customer holds all of it", async () => {
    const proxied = await start({
      AUTH_FAILURE_LIMIT: "2",
      AUTH_FAILURE_WINDOW_MS: "60000",
      TRUST_PROXY: "true"
    });
    for (const address of ["2001:db8:1:2::1", "2001:db8:1:2::2"]) {
      await call("/send", { token: null, at: proxied, headers: { "x-forwarded-for": address } });
    }
    const next = { "x-forwarded-for": "2001:db8:1:2:dead:beef:0:3" };
    expect((await call("/send", { token: null, at: proxied, headers: next })).status).toBe(429);
    const neighbour = { "x-forwarded-for": "2001:db8:1:3::1" };
    expect((await call("/send", { body: valid, at: proxied, headers: neighbour })).status).not.toBe(
      429
    );
  }, 20_000);
});

describe("the request line", () => {
  it("answers a URL it cannot read with a 400, not an internal error", async () => {
    const response = await raw(
      base,
      "GET //[ HTTP/1.1\r\nHost: bridge\r\nConnection: close\r\n\r\n"
    );
    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    expect(response).toContain('"code":"invalid_url"');
  });
});

describe("connections", () => {
  it("closes a refused request whose body has not arrived, rather than waiting for it", async () => {
    const started = Date.now();
    const response = await raw(
      base,
      "POST /send HTTP/1.1\r\nHost: bridge\r\nContent-Type: application/json\r\n" +
        "Content-Length: 100000\r\n\r\n{"
    );
    expect(response).toMatch(/^HTTP\/1\.1 401 /);
    expect(response.toLowerCase()).toContain("connection: close");
    // `raw` resolves when the bridge ends the connection; the body never came.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("keeps a connection whose request was read whole, so a plugin's next call reuses it", async () => {
    const response = await call("/gibtesnicht", { method: "GET", token: null });
    expect(response.status).toBe(401);
    expect(response.headers.get("connection")).not.toBe("close");
  });
});

describe("shutdown", () => {
  it("exits cleanly on SIGTERM, so a redeploy is not a crash", async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [SERVER], {
      env: environment({ PORT: String(port) }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    running.push(child);

    const until = Date.now() + 10_000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
      } catch {
        // Not listening yet.
      }
      if (Date.now() > until) throw new Error("bridge did not become healthy");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const exit = new Promise((resolve) => child.on("exit", resolve));
    child.kill("SIGTERM");
    expect(await exit).toBe(0);
  }, 20_000);
});

describe("startup", () => {
  function attempt(overrides) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [SERVER], {
        env: environment(overrides),
        stdio: ["ignore", "pipe", "pipe"]
      });
      running.push(child);
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("exit", (code) => resolve({ code, stderr }));
    });
  }

  /** What a bridge says once it listens, and what it said before. */
  function startupLog(overrides) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SERVER], {
        env: environment(overrides),
        stdio: ["ignore", "pipe", "pipe"]
      });
      running.push(child);
      let stdout = "";
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.includes("listening on")) {
          // The warnings follow the listening line in the same callback.
          setTimeout(() => {
            child.kill("SIGKILL");
            resolve(stdout);
          }, 200);
        }
      });
      child.on("exit", (code) => {
        if (!stdout.includes("listening on")) reject(new Error(`exited with ${code}: ${stderr}`));
      });
    });
  }

  const target = (name, overrides = {}) => {
    const prefix = `PUBLISH_${name.toUpperCase()}`;
    return {
      [`${prefix}_HOST`]: "127.0.0.1",
      [`${prefix}_USER`]: "web",
      [`${prefix}_PASSWORD`]: "geheim",
      [`${prefix}_HOST_FINGERPRINT`]: "SHA256:abc",
      [`${prefix}_ROOT`]: "/var/www/site",
      [`${prefix}_STATE_ROOT`]: "/var/state/site",
      [`${prefix}_BASE_URL`]: "https://site.example.com",
      ...overrides
    };
  };

  it("warns once per target that publishes raw HTML, naming the switch", async () => {
    const stdout = await startupLog({
      PORT: String(await freePort()),
      PUBLISH_TOKEN: "publish-token-for-the-test-0123",
      PUBLISH_TARGETS: "blog,team",
      ...target("blog"),
      ...target("team", { PUBLISH_TEAM_ALLOW_HTML: "false" })
    });
    const warnings = stdout.split("\n").filter((line) => line.includes("raw HTML"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("publish target blog");
    expect(warnings[0]).toContain("more than one author");
    expect(warnings[0]).toContain("PUBLISH_BLOG_ALLOW_HTML=false");
  }, 15_000);

  it("refuses to start without a mailbox host, naming the variable", async () => {
    const { code, stderr } = await attempt({ IMAP_HOST: "", PORT: "0" });
    expect(code).not.toBe(0);
    expect(stderr).toContain("IMAP_HOST");
  }, 15_000);

  it("refuses to start with a weak token, and says how to make one", async () => {
    const { code, stderr } = await attempt({ MAIL_TOKEN: "kurz", PORT: "0" });
    expect(code).not.toBe(0);
    expect(stderr).toContain("openssl rand -base64 32");
  }, 15_000);

  it("refuses to start with no capability configured at all", async () => {
    const bare = { PATH: process.env.PATH, PORT: "0" };
    const { code, stderr } = await new Promise((resolve) => {
      const child = spawn(process.execPath, [SERVER], {
        env: bare,
        stdio: ["ignore", "pipe", "pipe"]
      });
      running.push(child);
      let text = "";
      child.stderr.on("data", (chunk) => {
        text += chunk;
      });
      child.on("exit", (exit) => resolve({ code: exit, stderr: text }));
    });
    expect(code).not.toBe(0);
    expect(stderr).toContain("No capability is configured");
  }, 15_000);
});
