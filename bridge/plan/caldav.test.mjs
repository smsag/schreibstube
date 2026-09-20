import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startCalDavServer } from "./caldav-fixture.mjs";
import { buildEvent, parseEvent } from "./ical.mjs";
import { CalDavError, createCalDavClient } from "./caldav.mjs";

/**
 * The client against a real CalDAV server, over real HTTP.
 *
 * What is being checked is the part that cannot be reasoned about from the
 * pure modules: that Basic auth goes out, that a redirect is followed only
 * within one host, that an update lands on the resource the server chose
 * rather than on a name we made up from the UID, and that a response nobody
 * wanted to buffer is abandoned instead.
 */

let server;

beforeAll(async () => {
  server = await startCalDavServer();
});

afterAll(async () => {
  await server.stop();
});

function client(overrides = {}) {
  return createCalDavClient({
    url: server.url,
    user: server.user,
    password: server.password,
    calendars: ["arbeit", "privat"],
    timeoutMs: 5000,
    maxResponseBytes: 1_000_000,
    ...overrides
  });
}

function ics({ uid, start = "20260920T080000Z", summary = "Termin" }) {
  return [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${start}`,
    "DTEND:20260920T090000Z",
    `SUMMARY:${summary}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

beforeEach(() => {
  server.clear();
});

describe("authentication and host binding", () => {
  it("sends Basic auth, and reports a refusal without quoting the body", async () => {
    const wrong = client({ password: "falsch" });
    await expect(
      wrong.listEvents({ from: "2026-09-01", to: "2026-09-30", limit: 10 })
    ).rejects.toThrow(/refused by the calendar server \(401\)/);
  });

  it("follows a redirect that stays on the configured host", async () => {
    const moved = client({ url: server.redirectUrl });
    const result = await moved.listEvents({ from: "2026-09-01", to: "2026-09-30", limit: 10 });
    expect(result.events).toEqual([]);
  });

  it("refuses to follow a redirect that leaves the configured host", async () => {
    const away = client({ url: server.offHostUrl });
    await expect(
      away.listEvents({ from: "2026-09-01", to: "2026-09-02", limit: 10 })
    ).rejects.toThrow(/somewhere this bridge will not follow/);
  });

  it("gives up on a redirect that never lands", async () => {
    const loop = client({ url: server.loopUrl });
    await expect(
      loop.listEvents({ from: "2026-09-01", to: "2026-09-02", limit: 10 })
    ).rejects.toThrow(/redirected too many times/);
  });

  it("refuses a redirect that asks for a different method", async () => {
    const other = client({ url: server.otherMethodUrl });
    await expect(
      other.listEvents({ from: "2026-09-01", to: "2026-09-02", limit: 10 })
    ).rejects.toThrow(/redirected to a GET/);
  });

  it("reports a server it cannot reach at all without quoting the address", async () => {
    const unreachable = createCalDavClient({
      url: "http://127.0.0.1:1/dav/",
      user: "a",
      password: "b",
      calendars: ["arbeit"],
      timeoutMs: 2000,
      maxResponseBytes: 1000
    });
    await expect(
      unreachable.listEvents({ from: "2026-09-01", to: "2026-09-02", limit: 10 })
    ).rejects.toThrow(CalDavError);
  });

  it("refuses a calendar name that could leave the collection", async () => {
    for (const name of ["..", "../andere", "mit leerzeichen", ""]) {
      await expect(
        client({ calendars: [name] }).listEvents({ from: "2026-09-01", to: "2026-09-02", limit: 5 })
      ).rejects.toThrow(/not a usable calendar name/);
    }
  });
});

describe("listing events", () => {
  it("returns nothing from an empty window", async () => {
    expect(await client().listEvents({ from: "2026-09-01", to: "2026-09-30", limit: 10 })).toEqual({
      events: [],
      truncated: false
    });
  });

  it("returns what the calendar holds inside the window, and nothing outside it", async () => {
    server.seed("arbeit", ics({ uid: "drin", start: "20260920T080000Z" }));
    server.seed("arbeit", ics({ uid: "draussen", start: "20261120T080000Z" }));

    const { events } = await client().listEvents({
      from: "2026-09-01",
      to: "2026-09-30",
      limit: 10
    });
    expect(events.map((event) => event.uid)).toEqual(["drin"]);
    expect(events[0]).toMatchObject({ calendar: "arbeit", title: "Termin", allDay: false });
  });

  it("names the calendar each event came from", async () => {
    server.seed("arbeit", ics({ uid: "a" }));
    server.seed("privat", ics({ uid: "p" }));

    const { events } = await client().listEvents({
      from: "2026-09-01",
      to: "2026-09-30",
      limit: 10
    });
    expect(events.map((event) => [event.uid, event.calendar]).sort()).toEqual([
      ["a", "arbeit"],
      ["p", "privat"]
    ]);
  });

  it("asks only the calendars the request named", async () => {
    server.seed("arbeit", ics({ uid: "a" }));
    server.seed("privat", ics({ uid: "p" }));

    const { events } = await client().listEvents({
      from: "2026-09-01",
      to: "2026-09-30",
      calendars: ["privat"],
      limit: 10
    });
    expect(events.map((event) => event.uid)).toEqual(["p"]);
  });

  it("drops a requested calendar the allowlist does not permit", async () => {
    server.seed("arbeit", ics({ uid: "a" }));
    const { events } = await client({ calendars: ["privat"] }).listEvents({
      from: "2026-09-01",
      to: "2026-09-30",
      calendars: ["arbeit"],
      limit: 10
    });
    expect(events).toEqual([]);
  });

  it("stops at the limit and says it did", async () => {
    for (const index of [1, 2, 3]) server.seed("arbeit", ics({ uid: `e${index}` }));

    const result = await client({ calendars: ["arbeit"] }).listEvents({
      from: "2026-09-01",
      to: "2026-09-30",
      limit: 2
    });
    expect(result.events).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("passes over a calendar that is no longer there", async () => {
    server.seed("arbeit", ics({ uid: "a" }));
    const { events } = await client({ calendars: ["arbeit", "verschwunden"] }).listEvents({
      from: "2026-09-01",
      to: "2026-09-30",
      limit: 10
    });
    expect(events.map((event) => event.uid)).toEqual(["a"]);
  });

  it("reports a refusal as a failure rather than as an empty day", async () => {
    await expect(
      client({ calendars: ["verboten"] }).listEvents({
        from: "2026-09-01",
        to: "2026-09-30",
        limit: 10
      })
    ).rejects.toThrow(/refused by the calendar server \(403\)/);
  });

  it("abandons a response larger than the bound rather than buffering it", async () => {
    await expect(
      client({ calendars: ["riesig"], maxResponseBytes: 2000 }).listEvents({
        from: "2026-09-01",
        to: "2026-09-30",
        limit: 10
      })
    ).rejects.toThrow(/returned more than 2000 bytes/);
  });

  it("skips an entry the server returned without usable calendar data", async () => {
    server.seed("arbeit", "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    server.seed("arbeit", ics({ uid: "gut" }));
    const { events } = await client({ calendars: ["arbeit"] }).listEvents({
      from: "2026-09-01",
      to: "2026-09-30",
      limit: 10
    });
    expect(events.map((event) => event.uid)).toEqual(["gut"]);
  });
});

describe("discovering calendars", () => {
  it("takes the allowlist as given rather than asking", async () => {
    expect(await client({ calendars: ["arbeit"] }).listCalendars()).toEqual([
      { name: "arbeit", displayName: "arbeit" }
    ]);
  });

  it("asks the server when no allowlist was configured", async () => {
    expect(await client({ calendars: [] }).listCalendars()).toEqual([
      { name: "arbeit", displayName: "Die arbeit" },
      { name: "privat", displayName: "Die privat" }
    ]);
  });

  it("uses the discovered set as the allowlist for a query", async () => {
    server.seed("arbeit", ics({ uid: "a" }));
    const { events } = await client({ calendars: [] }).listEvents({
      from: "2026-09-01",
      to: "2026-09-30",
      limit: 10
    });
    expect(events.map((event) => event.uid)).toEqual(["a"]);
  });
});

describe("writing events", () => {
  it("creates an event and returns the identifier it was stored under", async () => {
    const { uid } = await client().saveEvent({
      title: "Kapitel 3",
      start: "2026-09-20T08:00:00Z",
      end: "2026-09-20T10:00:00Z",
      calendar: "arbeit"
    });
    expect(uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.resources("arbeit")).toContain(`${uid}.ics`);
    expect(server.contents("arbeit").join()).toContain("SUMMARY:Kapitel 3");
  });

  it("keeps the notes it was given", async () => {
    const { uid } = await client().saveEvent({
      title: "Lesen",
      notes: "Seite 40, dann 50",
      start: "2026-09-20T08:00:00Z",
      end: "2026-09-20T10:00:00Z",
      calendar: "arbeit"
    });
    const stored = server.contents("arbeit").find((text) => text.includes(uid));
    expect(parseEvent(stored).notes).toBe("Seite 40, dann 50");
  });

  it("writes an all-day event as a date on both ends", async () => {
    const { uid } = await client().saveEvent({
      title: "Urlaub",
      start: "2026-09-20",
      end: "2026-09-27",
      calendar: "arbeit",
      allDay: true
    });
    const stored = server.contents("arbeit").find((text) => text.includes(uid));
    expect(parseEvent(stored)).toMatchObject({ allDay: true, start: "2026-09-20" });
  });

  it("updates in place, on the resource the server chose rather than on the UID", async () => {
    // Another client stored it under a name of its own, as iCloud does.
    const resource = server.seed("arbeit", ics({ uid: "block-1", summary: "Alt" }), {
      resource: "9f1a-fremder-name.ics"
    });

    await client().saveEvent({
      uid: "block-1",
      title: "Neu",
      start: "2026-09-20T08:00:00Z",
      end: "2026-09-20T09:00:00Z",
      calendar: "arbeit"
    });

    expect(server.resources("arbeit")).toEqual([resource]);
    expect(server.contents("arbeit")[0]).toContain("SUMMARY:Neu");
  });

  it("falls back to a name of its own when the UID is nowhere yet", async () => {
    await client().saveEvent({
      uid: "block-neu",
      title: "Erst jetzt",
      start: "2026-09-20T08:00:00Z",
      end: "2026-09-20T09:00:00Z",
      calendar: "arbeit"
    });
    expect(server.resources("arbeit")).toEqual(["block-neu.ics"]);
  });

  it("refuses a calendar the allowlist does not name", async () => {
    await expect(
      client({ calendars: ["privat"] }).saveEvent({
        title: "Nein",
        start: "2026-09-20T08:00:00Z",
        end: "2026-09-20T09:00:00Z",
        calendar: "arbeit"
      })
    ).rejects.toThrow(/not one this bridge may write to/);
  });

  it("refuses an identifier that could leave the collection", async () => {
    await expect(
      client().saveEvent({
        uid: "..",
        title: "Nein",
        start: "2026-09-20T08:00:00Z",
        end: "2026-09-20T09:00:00Z",
        calendar: "arbeit"
      })
    ).rejects.toThrow(/not a usable event identifier/);
  });

  it("escapes a title through to the stored event", async () => {
    const { uid } = await client().saveEvent({
      title: "Lesen, schreiben; Pause",
      start: "2026-09-20T08:00:00Z",
      end: "2026-09-20T09:00:00Z",
      calendar: "arbeit"
    });
    const stored = server.contents("arbeit").find((text) => text.includes(uid));
    expect(stored).toContain("SUMMARY:Lesen\\, schreiben\\; Pause");
    expect(parseEvent(stored).title).toBe("Lesen, schreiben; Pause");
  });
});

describe("deleting events", () => {
  it("removes the resource the UID actually lives on", async () => {
    server.seed("arbeit", ics({ uid: "block-1" }), { resource: "fremder-name.ics" });
    expect(await client().deleteEvent({ uid: "block-1", calendar: "arbeit" })).toEqual({
      deleted: true
    });
    expect(server.resources("arbeit")).toEqual([]);
  });

  it("says nothing was deleted when nothing was there", async () => {
    expect(await client().deleteEvent({ uid: "gibt-es-nicht", calendar: "arbeit" })).toEqual({
      deleted: false
    });
  });

  it("refuses a calendar the allowlist does not name", async () => {
    await expect(
      client({ calendars: ["privat"] }).deleteEvent({ uid: "a", calendar: "arbeit" })
    ).rejects.toThrow(/not one this bridge may write to/);
  });

  it("leaves the other events alone", async () => {
    server.seed("arbeit", ics({ uid: "eins" }), { resource: "eins.ics" });
    server.seed("arbeit", ics({ uid: "zwei" }), { resource: "zwei.ics" });
    await client().deleteEvent({ uid: "eins", calendar: "arbeit" });
    expect(server.resources("arbeit")).toEqual(["zwei.ics"]);
  });
});

describe("the round trip", () => {
  it("reads back what it wrote, through the calendar rather than past it", async () => {
    const written = await client().saveEvent({
      title: "Frühstück & Kapitel 3, Teil 2",
      notes: "Zeile eins\nZeile zwei",
      start: "2026-09-20T06:30:00Z",
      end: "2026-09-20T08:00:00Z",
      calendar: "arbeit"
    });

    const { events } = await client().listEvents({
      from: "2026-09-20",
      to: "2026-09-20",
      calendars: ["arbeit"],
      limit: 10
    });

    expect(events).toEqual([
      {
        uid: written.uid,
        title: "Frühstück & Kapitel 3, Teil 2",
        notes: "Zeile eins\nZeile zwei",
        start: "2026-09-20T06:30:00.000Z",
        end: "2026-09-20T08:00:00.000Z",
        allDay: false,
        calendar: "arbeit"
      }
    ]);
  });

  it("stores a long title folded, and reads it back whole", async () => {
    const title = "Ein sehr langer Titel mit Umlauten äöü, der gefaltet werden muss ".repeat(4);
    const { uid } = await client().saveEvent({
      title,
      start: "2026-09-21T06:30:00Z",
      end: "2026-09-21T08:00:00Z",
      calendar: "privat"
    });

    const stored = server.contents("privat").find((text) => text.includes(uid));
    expect(stored).toContain("\r\n ");
    const { events } = await client().listEvents({
      from: "2026-09-21",
      to: "2026-09-21",
      calendars: ["privat"],
      limit: 10
    });
    expect(events[0].title).toBe(title);
  });
});

describe("the fixture itself", () => {
  it("refuses a request with no credentials at all", async () => {
    const response = await fetch(server.url);
    expect(response.status).toBe(401);
  });

  it("refuses to create over an existing resource when asked not to", async () => {
    // What `If-None-Match: *` is for: the create path never overwrites.
    server.seed("arbeit", ics({ uid: "da" }), { resource: "da.ics" });
    const response = await fetch(new URL("arbeit/da.ics", server.url), {
      method: "PUT",
      headers: {
        authorization: `Basic ${Buffer.from(`${server.user}:${server.password}`).toString("base64")}`,
        "if-none-match": "*"
      },
      body: buildEvent({
        uid: "da",
        title: "x",
        start: "2026-09-20T08:00:00Z",
        end: "2026-09-20T09:00:00Z"
      })
    });
    expect(response.status).toBe(412);
  });

  it("answers 404 outside the collection it serves", async () => {
    const response = await fetch(new URL("/woanders/", server.url), {
      headers: {
        authorization: `Basic ${Buffer.from(`${server.user}:${server.password}`).toString("base64")}`
      }
    });
    expect(response.status).toBe(404);
  });
});
