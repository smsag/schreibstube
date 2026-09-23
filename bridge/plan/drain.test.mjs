import { describe, expect, it } from "vitest";
import { DocumentError, emptyDocument, MAX_COMPLETIONS } from "./document.mjs";
import {
  acknowledge,
  checkReport,
  matchFor,
  MAX_REPORTED_REMINDERS,
  pendingOps
} from "./drain.mjs";

const AT = "2026-09-20T07:00:00.000Z";

function upsert(seq, key, done = false) {
  return {
    seq,
    op: "upsert",
    key,
    title: key,
    notes: `↩ Plan\nobsidian://schreibstube?key=${key}`,
    due: null,
    done,
    list: "Schreibstube"
  };
}

function planWith(overrides = {}) {
  return { ...emptyDocument(), ...overrides };
}

function reminder(key, done) {
  return { notes: `↩ Plan\nobsidian://schreibstube?key=${key}`, done };
}

describe("what there is to do", () => {
  it("is every operation past the acknowledged one, oldest first, with what to look for", () => {
    const document = planWith({
      queue: [upsert(3, "k-c"), upsert(1, "k-a"), upsert(2, "k-b")],
      acked: 1
    });

    const pending = pendingOps(document);

    expect(pending.acked).toBe(1);
    expect(pending.seq).toBe(3);
    expect(pending.ops.map((op) => op.key)).toEqual(["k-b", "k-c"]);
    expect(pending.ops[0].match).toBe(matchFor("k-b"));
  });

  it("is nothing once the queue has caught up", () => {
    const pending = pendingOps(planWith({ queue: [upsert(2, "k-a")], acked: 2 }));
    expect(pending).toEqual({ acked: 2, seq: 2, ops: [] });
  });
});

describe("what a drain reports back", () => {
  it("moves the acknowledgement up to what was applied, never past the queue or backwards", () => {
    const document = planWith({ queue: [upsert(5, "k-a")], acked: 3 });
    expect(acknowledge(document, { seq: 5, reminders: [] }, AT).acked).toBe(5);
    expect(acknowledge(document, { seq: 99, reminders: [] }, AT).acked).toBe(5);
    expect(acknowledge(document, { seq: 1, reminders: [] }, AT).acked).toBe(3);
  });

  it("turns a reminder ticked in Reminders into a completion for the note", () => {
    const document = planWith({ queue: [upsert(1, "k-a"), upsert(2, "k-b")], acked: 2 });

    const next = acknowledge(
      document,
      { seq: 2, reminders: [reminder("k-a", true), reminder("k-b", false)] },
      AT
    );

    expect(next.completions).toEqual([{ key: "k-a", done: true, at: AT }]);
  });

  it("reports nothing the planner itself sent", () => {
    const document = planWith({ queue: [upsert(1, "k-a", true)], acked: 1 });
    expect(
      acknowledge(document, { seq: 1, reminders: [reminder("k-a", true)] }, AT).completions
    ).toEqual([]);
  });

  it("leaves a reminder the drain has not yet brought up to date", () => {
    const document = planWith({ queue: [upsert(4, "k-a", true)], acked: 3 });
    const next = acknowledge(document, { seq: 3, reminders: [reminder("k-a", false)] }, AT);
    expect(next.completions).toEqual([]);
  });

  it("ignores reminders that are not the planner's, and ones it has deleted", () => {
    const document = planWith({ queue: [{ seq: 1, op: "delete", key: "k-a" }], acked: 1 });
    const next = acknowledge(
      document,
      { seq: 1, reminders: [reminder("k-a", true), { notes: "hand-made", done: true }] },
      AT
    );
    expect(next.completions).toEqual([]);
  });

  it("keeps one completion per task, the latest", () => {
    const document = planWith({
      queue: [upsert(1, "k-a")],
      acked: 1,
      completions: [{ key: "k-a", done: false, at: "2026-09-19T07:00:00.000Z" }]
    });
    const next = acknowledge(document, { seq: 1, reminders: [reminder("k-a", true)] }, AT);
    expect(next.completions).toEqual([{ key: "k-a", done: true, at: AT }]);
  });

  it("keeps no more completions than the plan may hold", () => {
    const queue = Array.from({ length: 10 }, (_, index) => upsert(index + 1, `k-${index}`));
    const completions = Array.from({ length: MAX_COMPLETIONS }, (_, index) => ({
      key: `k-old-${index}`,
      done: true,
      at: AT
    }));
    const next = acknowledge(
      planWith({ queue, acked: 10, completions }),
      { seq: 10, reminders: [reminder("k-0", true)] },
      AT
    );
    expect(next.completions).toHaveLength(MAX_COMPLETIONS);
    expect(next.completions.at(-1)).toMatchObject({ key: "k-0" });
  });
});

describe("checking a report", () => {
  it("accepts a sequence and what the list holds", () => {
    expect(checkReport({ seq: 2, reminders: [reminder("k-a", true)] })).toEqual({
      seq: 2,
      reminders: [reminder("k-a", true)]
    });
    expect(checkReport({ seq: 0 })).toEqual({ seq: 0, reminders: [] });
  });

  it("refuses what is not one, saying which part", () => {
    expect(() => checkReport(null)).toThrow(DocumentError);
    expect(() => checkReport({ seq: -1 })).toThrow(/seq/);
    expect(() => checkReport({ seq: 1, reminders: "no" })).toThrow(/reminders must be a list/);
    expect(() => checkReport({ seq: 1, reminders: [{ notes: 3, done: true }] })).toThrow(/notes/);
    expect(() => checkReport({ seq: 1, reminders: [{ notes: "", done: "Yes" }] })).toThrow(/done/);
    const many = Array.from({ length: MAX_REPORTED_REMINDERS + 1 }, () => reminder("k-a", true));
    expect(() => checkReport({ seq: 1, reminders: many })).toThrow(/at most/);
  });
});
