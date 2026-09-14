import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
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
const TOKEN = "t".repeat(32);
const MAX_BODY_BYTES = 2000;
const MAX_TEXT_CHARS = 100;

const running = [];
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

  it("reports the version pair the plugin compares against", async () => {
    const { json } = await call("/health", { method: "GET", token: null });
    expect(json.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(json.protocol).toBeGreaterThan(0);
  });

  it("names the capabilities this deployment offers", async () => {
    const { json } = await call("/health", { method: "GET", token: null });
    expect(json.capabilities).toEqual(["mail"]);
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

  it("gives every request its own id", async () => {
    const first = await call("/send", { token: null });
    const second = await call("/send", { token: null });
    expect(first.json.requestId).not.toBe(second.json.requestId);
  });
});

describe("request bodies", () => {
  it("rejects an announced body over the limit", async () => {
    const response = await call("/send", {
      body: { ...valid, subject: "x".repeat(MAX_BODY_BYTES) }
    });
    expect(response.status).toBe(413);
    expect(response.json.error).toContain(String(MAX_BODY_BYTES));
    expect(response.json.code).toBe("body_too_large");
  });

  it("rejects an oversized body that announced no length, with the reason rather than a reset", async () => {
    const response = await streamed("/send", ['{"text":"', "x".repeat(MAX_BODY_BYTES), '"}']);
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
});

describe("throttle behind a proxy", () => {
  it("keys on the socket and ignores X-Forwarded-For by default, so a client cannot pick its own address", async () => {
    const direct = await start({ AUTH_FAILURE_LIMIT: "2", AUTH_FAILURE_WINDOW_MS: "60000" });
    for (const claimed of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) {
      await call("/send", { token: null, at: direct, headers: { "x-forwarded-for": claimed } });
    }
    const blocked = await call("/send", { token: null, at: direct });
    expect(blocked.status).toBe(429);
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
