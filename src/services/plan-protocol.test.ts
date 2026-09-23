import { describe, expect, it } from "vitest";
import { emptyPlan } from "./plan-model";
import { parseHealth } from "./bridge-protocol";
import {
  conflictFrom,
  eventsOn,
  PLAN_PROTOCOL_VERSION,
  describePlanError,
  eventsQuery,
  parseEvents,
  parseEventUid,
  parseStoredPlan,
  PlanConflict
} from "./plan-protocol";

describe("what the bridge answers with", () => {
  it("reads the plan and the revision it was read at", () => {
    const stored = parseStoredPlan({ rev: 7, document: { v: 1, blocks: [] } });
    expect(stored).toEqual({ rev: 7, plan: emptyPlan() });
  });

  it("reads a missing or impossible revision as the start", () => {
    expect(parseStoredPlan({ document: {} }).rev).toBe(0);
    expect(parseStoredPlan({ rev: -3, document: {} }).rev).toBe(0);
    expect(parseStoredPlan("nonsense").plan).toEqual(emptyPlan());
  });

  it("reads the events it can and drops the rest", () => {
    const events = parseEvents({
      events: [
        {
          uid: "uid-1",
          title: "EA48 C2 Prototyp",
          start: "2026-09-20T05:30:00+02:00",
          end: "2026-09-20T06:00:00+02:00",
          calendar: "Berufliches",
          notes: "schreibstube:block=projects/ea48"
        },
        { uid: "uid-2", start: "no", end: "no" },
        { title: "no uid", start: "2026-09-20T05:30:00Z", end: "2026-09-20T06:00:00Z" },
        "nonsense"
      ]
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uid: "uid-1", allDay: false, calendar: "Berufliches" });
  });

  it("insists on an event id after writing one", () => {
    expect(parseEventUid({ uid: "uid-1" })).toBe("uid-1");
    expect(() => parseEventUid({})).toThrow(/event id/);
  });

  it("recognises a conflict by its code and the plan it carries", () => {
    const body = {
      error: "The stored plan has moved on.",
      code: "conflict",
      requestId: "abc",
      rev: 9,
      document: { v: 1, blocks: [] }
    };
    expect(conflictFrom(body)).toEqual({ rev: 9, plan: emptyPlan() });
    expect(conflictFrom({ ...body, document: undefined })).toBeNull();
    expect(conflictFrom({ error: "too large", code: "payload-too-large" })).toBeNull();
  });

  it("carries the newer plan on a conflict, so the change can be redone", () => {
    const conflict = new PlanConflict({ rev: 9, plan: emptyPlan() });
    expect(conflict.stored.rev).toBe(9);
    expect(conflict.name).toBe("PlanConflict");
  });
});

describe("the version handshake", () => {
  it("reads what the deployment runs, and nothing from a broken answer", () => {
    expect(
      parseHealth({ version: "2.5.0", protocol: 2, capabilities: ["mail", "", "plan"] })
    ).toEqual({ version: "2.5.0", protocol: 2, capabilities: ["mail", "plan"] });
    expect(parseHealth({})).toEqual({ version: "", protocol: 0, capabilities: [] });
    expect(parseHealth("nonsense")).toEqual({ version: "", protocol: 0, capabilities: [] });
  });

  it("needs the protocol the plan capability arrived in", () => {
    expect(PLAN_PROTOCOL_VERSION).toBe(2);
  });
});

describe("asking for a day", () => {
  it("names the window, and the calendars when there are any", () => {
    expect(eventsQuery("2026-09-20", "2026-09-21", [])).toBe(
      "/calendar/events?from=2026-09-20&to=2026-09-21"
    );
    expect(eventsQuery("2026-09-20", "2026-09-21", ["Berufliches", " "])).toBe(
      "/calendar/events?from=2026-09-20&to=2026-09-21&calendars=Berufliches"
    );
  });
});

describe("saying what went wrong", () => {
  it("names the setting a person can do something about", () => {
    expect(describePlanError(401, "")).toContain("token");
    expect(describePlanError(404, "")).toContain("planning capability");
    expect(describePlanError(413, "")).toContain("too large");
    expect(describePlanError(500, "")).toBeTruthy();
  });
});

describe("the events of one day", () => {
  const event = (uid: string, start: string, end: string, allDay = false) => ({
    uid,
    title: uid,
    start,
    end,
    allDay,
    calendar: "Arbeit",
    notes: ""
  });

  it("keeps what touches the local day, earliest first, and nothing from the next", () => {
    const day = eventsOn(
      [
        event("tomorrow", "2026-09-21T09:00:00", "2026-09-21T10:00:00"),
        event("late", "2026-09-20T21:00:00", "2026-09-20T22:00:00"),
        event("early", "2026-09-20T05:30:00", "2026-09-20T06:00:00"),
        event("overnight", "2026-09-19T23:00:00", "2026-09-20T01:00:00")
      ],
      "2026-09-20"
    );
    expect(day.map((one) => one.uid)).toEqual(["overnight", "early", "late"]);
  });

  it("reads an all-day event by its dates, whatever the reader's offset", () => {
    const day = eventsOn(
      [
        event("birthday", "2026-09-20", "2026-09-21", true),
        event("yesterday", "2026-09-19", "2026-09-20", true),
        event("week", "2026-09-18", "2026-09-25", true),
        event("no end", "2026-09-20", "2026-09-20", true)
      ],
      "2026-09-20"
    );
    expect(day.map((one) => one.uid).sort()).toEqual(["birthday", "no end", "week"]);
  });
});
