import { describe, expect, it } from "vitest";
import {
  blockNotes,
  blocksOn,
  blockTag,
  clampCapacity,
  currentBlock,
  dayKey,
  daysUntil,
  emptyPlan,
  generateKey,
  linkTarget,
  MAX_CAPACITY,
  normalizePlan,
  shiftDay,
  taskUrl,
  type PlanDocument
} from "./plan-model";

function block(uid: string, start: string, end: string, members: string[] = []) {
  return {
    uid,
    tag: "projects/ea48",
    title: "EA48",
    start,
    end,
    calendar: "Berufliches",
    members: members.map((key) => ({ key, text: key, path: "Plan.md", remind: false, done: false }))
  };
}

function planWith(blocks: ReturnType<typeof block>[]): PlanDocument {
  return { ...emptyPlan(), blocks };
}

describe("reading a plan that came from the bridge", () => {
  it("keeps what it can read and drops what it cannot", () => {
    const raw = {
      v: 1,
      deadlines: {
        "projects/ea48": { date: "2026-09-25", capacity: 3 },
        "projects/x": { date: "soon" },
        "bad tag": { date: "2026-09-25" }
      },
      blocks: [
        block("uid-1", "2026-09-20T05:30:00+02:00", "2026-09-20T06:00:00+02:00", ["k-a"]),
        { uid: "", tag: "t", start: "x", end: "y", members: [] },
        "nonsense"
      ],
      anchors: {
        "k-a": { path: "Plan.md", hash: "abc", text: "Task", ordinal: 1 },
        "k b": { path: "Plan.md" }
      },
      queue: [
        {
          seq: 2,
          op: "upsert",
          key: "k-a",
          title: "T",
          notes: "N",
          due: "2026-09-25",
          done: false
        },
        { seq: 3, op: "fly", key: "k-a" }
      ],
      acked: 1,
      completions: [{ key: "k-a", done: true, at: "2026-09-20T07:00:00Z" }],
      surprise: "dropped"
    };

    const plan = normalizePlan(raw);

    expect(Object.keys(plan.deadlines)).toEqual(["projects/ea48"]);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]?.members[0]?.key).toBe("k-a");
    expect(Object.keys(plan.anchors)).toEqual(["k-a"]);
    expect(plan.queue).toHaveLength(1);
    expect(plan.acked).toBe(1);
    expect(plan.completions[0]?.done).toBe(true);
    expect(plan).not.toHaveProperty("surprise");
  });

  it("reads nonsense as an empty plan rather than throwing", () => {
    expect(normalizePlan(null)).toEqual(emptyPlan());
    expect(normalizePlan("[]")).toEqual(emptyPlan());
    expect(normalizePlan({ blocks: "no" })).toEqual(emptyPlan());
  });

  it("drops a deadline capacity that is not a number, and caps a silly one", () => {
    const plan = normalizePlan({
      deadlines: {
        a: { date: "2026-01-01", capacity: "many" },
        b: { date: "2026-01-01", capacity: 900 }
      }
    });
    expect(plan.deadlines.a).toEqual({ date: "2026-01-01" });
    expect(plan.deadlines.b).toEqual({ date: "2026-01-01", capacity: 50 });
  });
});

describe("keys", () => {
  it("are opaque and never look like something from a note", () => {
    expect(generateKey(() => 0)).toBe("k-aaaaaaaaaa");
    expect(generateKey()).toMatch(/^k-[a-z0-9]{10}$/);
  });

  it("lead a reminder back to its task", () => {
    expect(taskUrl("k-abc")).toBe("obsidian://schreibstube?key=k-abc");
  });

  it("tell a planner link from one 1.35 made, and from one that asks for nothing", () => {
    expect(linkTarget({ key: "k-abc" })).toEqual({ key: "k-abc" });
    expect(linkTarget({ task: "ab12cd" })).toEqual({ legacy: "ab12cd" });
    expect(linkTarget({ done: "1" })).toBeNull();
    expect(linkTarget({ key: "../etc" })).toBeNull();
  });
});

describe("tasks per block", () => {
  it("is a whole number from one to the bound", () => {
    expect(clampCapacity(3)).toBe(3);
    expect(clampCapacity(2.5)).toBe(3);
    expect(clampCapacity(0)).toBe(1);
    expect(clampCapacity(100)).toBe(MAX_CAPACITY);
    expect(clampCapacity(Number.NaN)).toBe(1);
  });
});

describe("the marker a block carries in its calendar event", () => {
  it("is written and read back, and an ordinary meeting has none", () => {
    expect(blockTag(blockNotes("projects/ea48"))).toBe("projects/ea48");
    expect(blockTag(`Agenda\n${blockNotes("lex")}`)).toBe("lex");
    expect(blockTag("an ordinary meeting")).toBeNull();
  });
});

describe("days and blocks", () => {
  it("writes a local day and steps by days", () => {
    expect(dayKey(new Date(2026, 8, 20, 23, 30))).toBe("2026-09-20");
    expect(dayKey(shiftDay(new Date(2026, 8, 30), 1))).toBe("2026-10-01");
  });

  it("counts whole days to a date, negative once it has passed", () => {
    const today = new Date(2026, 8, 20, 11, 0);
    expect(daysUntil("2026-09-25", today)).toBe(5);
    expect(daysUntil("2026-09-20", today)).toBe(0);
    expect(daysUntil("2026-09-18", today)).toBe(-2);
  });

  it("lists a day's blocks earliest first", () => {
    const plan = planWith([
      block("late", "2026-09-20T09:00:00", "2026-09-20T10:00:00"),
      block("early", "2026-09-20T05:30:00", "2026-09-20T06:00:00"),
      block("tomorrow", "2026-09-21T05:30:00", "2026-09-21T06:00:00")
    ]);
    expect(blocksOn(plan, "2026-09-20").map((one) => one.uid)).toEqual(["early", "late"]);
  });

  it("keeps a running block current although its first minutes have passed", () => {
    const plan = planWith([
      block("now", "2026-09-20T05:30:00", "2026-09-20T06:00:00"),
      block("next", "2026-09-20T09:00:00", "2026-09-20T10:00:00")
    ]);
    expect(currentBlock(plan, new Date("2026-09-20T05:33:00"))?.uid).toBe("now");
    expect(currentBlock(plan, new Date("2026-09-20T06:05:00"))?.uid).toBe("next");
    expect(currentBlock(plan, new Date("2026-09-20T23:00:00"))).toBeNull();
  });
});
