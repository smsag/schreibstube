import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";

/**
 * Characterisation tests for the HTTP layer.
 *
 * The bridge is started as a real process and driven over real HTTP, because
 * `server.mjs` reads its configuration and binds its port at import time. That
 * is also the honest test: routing, auth and the body limits are properties of
 * the running service, and they should survive the restructure unchanged.
 *
 * IMAP and SMTP point at a closed port, so anything that reaches the protocols
 * fails immediately and the failure path is exercised rather than skipped.
 */

const SERVER = fileURLToPath(new URL("./server.mjs", import.meta.url));
const TOKEN = "t".repeat(32);
const MAX_BODY_BYTES = 2000;
const MAX_TEXT_CHARS = 100;

let child;
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
    BRIDGE_TOKEN: TOKEN,
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
    ...overrides
  };
}

async function waitForHealth(url, deadlineMs = 10_000) {
  const until = Date.now() + deadlineMs;
  for (;;) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) throw new Error("bridge did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function call(path, { method = "POST", token = TOKEN, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
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
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], {
    env: environment({ PORT: String(port) }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForHealth(base);
}, 20_000);

afterAll(() => {
  child?.kill("SIGKILL");
});

describe("health", () => {
  it("answers without a token, so a platform probe can reach it", async () => {
    const response = await call("/health", { method: "GET", token: null });
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ status: "ok" });
  });

  it("answers JSON that must not be cached", async () => {
    const response = await call("/health", { method: "GET", token: null });
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("routing", () => {
  it("refuses any method but POST on the real endpoints", async () => {
    const response = await call("/send", { method: "GET" });
    expect(response.status).toBe(405);
    expect(response.json).toEqual({ error: "Method not allowed." });
  });

  it("reports an unknown path, but only to a caller who is authorised", async () => {
    const response = await call("/gibtesnicht", { body: {} });
    expect(response.status).toBe(404);
  });

  it("checks the token before the path, so an unknown path leaks nothing", async () => {
    const response = await call("/gibtesnicht", { token: null, body: {} });
    expect(response.status).toBe(401);
  });
});

describe("authorisation", () => {
  it("rejects a missing token", async () => {
    const response = await call("/send", { token: null, body: valid });
    expect(response.status).toBe(401);
    expect(response.json).toEqual({ error: "Unauthorized." });
  });

  it("rejects a wrong token identically, revealing nothing about which it was", async () => {
    const missing = await call("/send", { token: null, body: valid });
    const wrong = await call("/send", { token: "f".repeat(32), body: valid });
    expect(wrong.status).toBe(missing.status);
    expect(wrong.text).toBe(missing.text);
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

describe("request bodies", () => {
  it("rejects an announced body over the limit", async () => {
    const response = await call("/send", { body: { ...valid, subject: "x".repeat(MAX_BODY_BYTES) } });
    expect(response.status).toBe(413);
    expect(response.json.error).toContain(String(MAX_BODY_BYTES));
  });

  it("rejects an oversized body that announced no length, with the reason rather than a reset", async () => {
    const response = await streamed("/send", ['{"text":"', "x".repeat(MAX_BODY_BYTES), '"}']);
    expect(response.status).toBe(413);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await call("/send", { body: "{kein json" });
    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: "Request body is not valid JSON." });
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
    const response = await call("/send", { body: { bcc: ["a@example.com"], subject: "S", text: "T" } });
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
  });

  // An array passes the `typeof === "object"` check and falls through to the
  // recipient rule. Recorded as it is: the message is still correct, just not
  // the one about shape.
  it("treats an array as an object and fails it on the recipient rule", async () => {
    expect(await reject("[]")).toContain("recipient");
  });
});

describe("upstream failures", () => {
  it("reports an unreachable SMTP server as a bad gateway", async () => {
    const response = await call("/send", { body: valid });
    expect(response.status).toBe(502);
    expect(response.json.error).toMatch(/^Send failed: /);
  });

  it("reports an unreachable IMAP server as a bad gateway", async () => {
    const response = await call("/search", { body: {} });
    expect(response.status).toBe(502);
    expect(response.json.error).toMatch(/^Search failed: /);
  });
});

describe("startup", () => {
  function start(overrides) {
    return new Promise((resolve) => {
      const attempt = spawn(process.execPath, [SERVER], {
        env: environment(overrides),
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      attempt.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      attempt.on("exit", (code) => resolve({ code, stderr }));
    });
  }

  it("refuses to start without a mailbox host, naming the variable", async () => {
    const { code, stderr } = await start({ IMAP_HOST: "", PORT: "0" });
    expect(code).not.toBe(0);
    expect(stderr).toContain("IMAP_HOST");
  }, 15_000);

  it("refuses to start with a weak token, and says how to make one", async () => {
    const { code, stderr } = await start({ BRIDGE_TOKEN: "kurz", PORT: "0" });
    expect(code).not.toBe(0);
    expect(stderr).toContain("openssl rand -base64 32");
  }, 15_000);
});
