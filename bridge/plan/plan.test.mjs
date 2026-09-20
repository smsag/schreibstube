import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startCalDavServer } from "./caldav-fixture.mjs";
import { emptyDocument } from "./document.mjs";
import { MAX_WINDOW_DAYS } from "./routes.mjs";

/**
 * The plan capability, end to end.
 *
 * A real bridge process, a real CalDAV server, a real file on disk. The claims
 * worth making here are claims about the running service — that a revision
 * survives a round trip, that two writers cannot both win, that the calendar
 * routes refuse a window nobody could have meant, and that a mail token does
 * not open any of it.
 */

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const TOKEN = "p".repeat(32);
const MAIL_TOKEN = "m".repeat(32);

let caldav;
let child;
let base;
let directory;

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

async function call(method, path, { body, token = TOKEN } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const get = (path, options) => call("GET", path, options);
const post = (path, body, options) => call("POST", path, { body, ...options });
const put = (path, body, options) => call("PUT", path, { body, ...options });

function planWith(overrides = {}) {
  return { ...emptyDocument(), ...overrides };
}

/** Put the stored plan back to empty, whatever the tests before left behind. */
async function reset() {
  const current = await get("/plan");
  if (current.json.rev === 0) return;
  await put("/plan", { rev: current.json.rev, document: emptyDocument() });
}

beforeAll(async () => {
  caldav = await startCalDavServer();
  directory = await mkdtemp(join(tmpdir(), "schreibstube-plan-e2e-"));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;

  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      PLAN_TOKEN: TOKEN,
      PLAN_STORE: join(directory, "state", "plan.json"),
      CALDAV_URL: caldav.url,
      CALDAV_USER: caldav.user,
      CALDAV_PASSWORD: caldav.password,
      CALDAV_CALENDARS: "arbeit,privat",
      MAIL_TOKEN,
      IMAP_HOST: "127.0.0.1",
      IMAP_PORT: "1",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1",
      MAIL_USER: "post@example.com",
      MAIL_PASSWORD: "geheim",
      MAIL_FROM: "post@example.com",
      AUTH_FAILURE_LIMIT: "1000",
      UPSTREAM_TIMEOUT_MS: "10000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const until = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) throw new Error("bridge did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}, 40_000);

afterAll(async () => {
  child?.kill("SIGKILL");
  await caldav?.stop();
  await rm(directory, { recursive: true, force: true });
});

beforeEach(() => {
  caldav.clear();
});

describe("the capability itself", () => {
  it("is announced by /health, alongside the protocol the plugin checks", async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.capabilities).toEqual(expect.arrayContaining(["mail", "plan"]));
    expect(health.protocol).toBe(2);
  });

  it("is closed to the mail token, which belongs to another capability", async () => {
    for (const path of ["/plan", "/calendar/events?from=2026-09-01&to=2026-09-02"]) {
      expect((await get(path, { token: MAIL_TOKEN })).status).toBe(401);
    }
  });

  it("is closed to no token at all, and says no more than that", async () => {
    const response = await fetch(`${base}/plan`);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("unauthorized");
  });

  it("refuses a method the route does not offer", async () => {
    expect((await call("DELETE", "/plan")).status).toBe(405);
  });
});

describe("GET and PUT /plan", () => {
  it("reads the empty document before anything was ever stored", async () => {
    await reset();
    const response = await get("/plan");
    expect(response.status).toBe(200);
    expect(response.json.document).toEqual(emptyDocument());
  });

  it("stores a document and answers with the revision the server assigned", async () => {
    const before = (await get("/plan")).json.rev;
    const stored = await put("/plan", { rev: before, document: planWith({ acked: 4 }) });
    expect(stored.status).toBe(200);
    expect(stored.json).toEqual({ rev: before + 1 });

    const after = await get("/plan");
    expect(after.json).toEqual({ rev: before + 1, document: planWith({ acked: 4 }) });
  });

  it("refuses a write against a revision that moved, and hands back the winner", async () => {
    const before = (await get("/plan")).json.rev;
    await put("/plan", { rev: before, document: planWith({ acked: 10 }) });

    const late = await put("/plan", { rev: before, document: planWith({ acked: 99 }) });
    expect(late.status).toBe(409);
    expect(late.json.code).toBe("conflict");
    expect(late.json.rev).toBe(before + 1);
    expect(late.json.document).toEqual(planWith({ acked: 10 }));
    expect(late.json.requestId).toMatch(/^req_/);
  });

  it("leaves the stored document alone when it refuses", async () => {
    const before = (await get("/plan")).json.rev;
    await put("/plan", { rev: before, document: planWith({ acked: 1 }) });
    await put("/plan", { rev: before, document: planWith({ acked: 2 }) });
    expect((await get("/plan")).json.document.acked).toBe(1);
  });

  it("requires a revision, and one that is a counter", async () => {
    for (const rev of [undefined, "0", -1, 1.5, null]) {
      const response = await put("/plan", { rev, document: emptyDocument() });
      expect(response.status).toBe(400);
      expect(response.json.code).toBe("invalid_request");
    }
  });

  it("refuses a document that does not validate, naming the field", async () => {
    const rev = (await get("/plan")).json.rev;
    const response = await put("/plan", {
      rev,
      document: planWith({ blocks: [{ uid: "a", tag: "t" }] })
    });
    expect(response.status).toBe(400);
    expect(response.json.code).toBe("invalid_document");
    expect(response.json.error).toMatch(/blocks\[0\]/);
  });

  it("refuses a body that is not an object at all", async () => {
    const response = await put("/plan", { rev: 0, document: "ein Plan" });
    expect(response.status).toBe(400);
    expect(response.json.error).toMatch(/document must be an object/);
  });

  it("refuses a body over the limit before it reads all of it", async () => {
    const response = await fetch(`${base}/plan`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ rev: 0, document: { v: 1, füllung: "x".repeat(700_000) } })
    });
    expect(response.status).toBe(413);
  });

  it("stores a real plan with every section filled in", async () => {
    const document = planWith({
      deadlines: { "buch/kapitel-3": { date: "2026-12-01", capacity: 3 } },
      blocks: [
        {
          uid: "block-1",
          tag: "schreiben",
          title: "Vormittag",
          start: "2026-09-20T08:00:00Z",
          end: "2026-09-20T10:00:00Z",
          calendar: "arbeit",
          members: [
            { key: "a1", text: "Kapitel lesen", path: "Notizen/Buch.md", remind: true, done: false }
          ]
        }
      ],
      anchors: { a1: { path: "Notizen/Buch.md", hash: "abc", text: "Kapitel lesen", ordinal: 2 } },
      queue: [{ seq: 7, op: "upsert", key: "a1", title: "Kapitel lesen", due: null }],
      acked: 6,
      completions: [{ key: "a1", done: true, at: "2026-09-20T10:05:00Z" }]
    });

    const rev = (await get("/plan")).json.rev;
    expect((await put("/plan", { rev, document })).status).toBe(200);
    expect((await get("/plan")).json.document).toEqual(document);
  });
});

describe("GET /calendar/events", () => {
  const window = "from=2026-09-01&to=2026-09-30";

  it("returns an empty window as an empty list", async () => {
    const response = await get(`/calendar/events?${window}`);
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ events: [], truncated: false });
  });

  it("returns what the calendar holds, with the calendar named on each event", async () => {
    await post("/calendar/events", {
      title: "Kapitel 3",
      start: "2026-09-20T08:00:00Z",
      end: "2026-09-20T10:00:00Z",
      calendar: "arbeit"
    });

    const response = await get(`/calendar/events?${window}`);
    expect(response.json.events).toHaveLength(1);
    expect(response.json.events[0]).toMatchObject({
      title: "Kapitel 3",
      calendar: "arbeit",
      allDay: false,
      start: "2026-09-20T08:00:00.000Z",
      end: "2026-09-20T10:00:00.000Z"
    });
  });

  it("intersects the requested calendars with the configured allowlist", async () => {
    await post("/calendar/events", {
      title: "Nur privat",
      start: "2026-09-20T08:00:00Z",
      end: "2026-09-20T10:00:00Z",
      calendar: "privat"
    });

    const mine = await get(`/calendar/events?${window}&calendars=privat`);
    expect(mine.json.events).toHaveLength(1);

    const theirs = await get(`/calendar/events?${window}&calendars=verboten`);
    expect(theirs.status).toBe(200);
    expect(theirs.json.events).toEqual([]);
  });

  it("requires both bounds, as dates", async () => {
    for (const query of ["", "from=2026-09-01", "to=2026-09-02", "from=x&to=2026-09-02"]) {
      const response = await get(`/calendar/events?${query}`);
      expect(response.status).toBe(400);
      expect(response.json.code).toBe("invalid_request");
    }
  });

  it("refuses a window that runs backwards", async () => {
    const response = await get("/calendar/events?from=2026-09-30&to=2026-09-01");
    expect(response.status).toBe(400);
    expect(response.json.error).toMatch(/to must not precede from/);
  });

  it("refuses a window wider than the bridge will answer", async () => {
    const response = await get("/calendar/events?from=2026-01-01&to=2026-12-31");
    expect(response.status).toBe(400);
    expect(response.json.code).toBe("window_too_wide");
    expect(response.json.error).toContain(String(MAX_WINDOW_DAYS));
  });

  it("accepts a window of exactly the limit, and a window of one day", async () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    const end = new Date(start.getTime() + (MAX_WINDOW_DAYS - 1) * 86_400_000);
    const widest = await get(
      `/calendar/events?from=2026-01-01&to=${end.toISOString().slice(0, 10)}`
    );
    expect(widest.status).toBe(200);
    expect((await get("/calendar/events?from=2026-09-20&to=2026-09-20")).status).toBe(200);
  });

  it("refuses a calendar name it could not address safely", async () => {
    const response = await get(`/calendar/events?${window}&calendars=..`);
    expect(response.status).toBe(400);
    expect(response.json.error).toMatch(/calendar name is required/);
  });
});

describe("POST /calendar/events", () => {
  const event = {
    title: "Kapitel 3",
    start: "2026-09-20T08:00:00Z",
    end: "2026-09-20T10:00:00Z",
    calendar: "arbeit"
  };

  it("creates an event and answers with the identifier to address it by", async () => {
    const response = await post("/calendar/events", event);
    expect(response.status).toBe(200);
    expect(response.json.uid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("updates in place when the identifier is given back", async () => {
    const created = await post("/calendar/events", event);
    const updated = await post("/calendar/events", {
      ...event,
      uid: created.json.uid,
      title: "Kapitel 4"
    });
    expect(updated.json.uid).toBe(created.json.uid);

    const listed = await get("/calendar/events?from=2026-09-20&to=2026-09-20");
    expect(listed.json.events).toHaveLength(1);
    expect(listed.json.events[0].title).toBe("Kapitel 4");
  });

  it("writes an all-day event when asked for one", async () => {
    await post("/calendar/events", {
      title: "Urlaub",
      start: "2026-09-21",
      end: "2026-09-22",
      calendar: "privat",
      allDay: true
    });
    const listed = await get("/calendar/events?from=2026-09-21&to=2026-09-21");
    expect(listed.json.events[0]).toMatchObject({ allDay: true, start: "2026-09-21" });
  });

  it("keeps notes through the round trip", async () => {
    await post("/calendar/events", { ...event, notes: "Seite 40, dann 50; zügig" });
    const listed = await get("/calendar/events?from=2026-09-20&to=2026-09-20");
    expect(listed.json.events[0].notes).toBe("Seite 40, dann 50; zügig");
  });

  it("requires a title, a calendar and two moments", async () => {
    for (const body of [
      { ...event, title: "" },
      { ...event, title: 5 },
      { ...event, calendar: undefined },
      { ...event, start: "2026-09-20" },
      { ...event, end: "bald" }
    ]) {
      const response = await post("/calendar/events", body);
      expect(response.status).toBe(400);
      expect(response.json.code).toBe("invalid_request");
    }
  });

  it("requires dates rather than moments for an all-day event", async () => {
    const response = await post("/calendar/events", {
      ...event,
      allDay: true,
      start: "2026-09-20T08:00:00Z",
      end: "2026-09-21"
    });
    expect(response.status).toBe(400);
    expect(response.json.error).toMatch(/must be a date, as YYYY-MM-DD/);
  });

  it("refuses an end before its start", async () => {
    const response = await post("/calendar/events", {
      ...event,
      start: "2026-09-20T10:00:00Z",
      end: "2026-09-20T08:00:00Z"
    });
    expect(response.json.error).toMatch(/end must not precede start/);
  });

  it("bounds the title and the notes", async () => {
    expect((await post("/calendar/events", { ...event, title: "x".repeat(501) })).status).toBe(400);
    expect((await post("/calendar/events", { ...event, notes: "x".repeat(4001) })).status).toBe(
      400
    );
    expect((await post("/calendar/events", { ...event, notes: 5 })).status).toBe(400);
    expect((await post("/calendar/events", { ...event, allDay: "ja" })).status).toBe(400);
  });

  it("refuses an identifier that could leave the collection", async () => {
    const response = await post("/calendar/events", { ...event, uid: "../anderswo" });
    expect(response.status).toBe(400);
    expect(response.json.error).toMatch(/uid must be/);
  });

  it("reports a calendar the allowlist does not name as an upstream refusal", async () => {
    const response = await post("/calendar/events", { ...event, calendar: "geheim" });
    expect(response.status).toBe(502);
    expect(response.json.code).toBe("caldav_error");
  });
});

describe("POST /calendar/events/delete", () => {
  it("deletes the event and says so", async () => {
    const created = await post("/calendar/events", {
      title: "Weg damit",
      start: "2026-09-20T08:00:00Z",
      end: "2026-09-20T09:00:00Z",
      calendar: "arbeit"
    });

    const removed = await post("/calendar/events/delete", {
      uid: created.json.uid,
      calendar: "arbeit"
    });
    expect(removed.json).toEqual({ deleted: true });
    expect((await get("/calendar/events?from=2026-09-20&to=2026-09-20")).json.events).toEqual([]);
  });

  it("says nothing was deleted when there was nothing there", async () => {
    const response = await post("/calendar/events/delete", {
      uid: "gibt-es-nicht",
      calendar: "arbeit"
    });
    expect(response.json).toEqual({ deleted: false });
  });

  it("requires both a uid and a calendar", async () => {
    expect((await post("/calendar/events/delete", { calendar: "arbeit" })).status).toBe(400);
    expect((await post("/calendar/events/delete", { uid: "a" })).status).toBe(400);
    expect((await post("/calendar/events/delete", { uid: "..", calendar: "arbeit" })).status).toBe(
      400
    );
  });
});
