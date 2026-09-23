import { describe, expect, it } from "vitest";
import { emptyPlan, type PlanBlock, type PlanDocument } from "./plan-model";
import {
  DEFAULT_PREFERENCES,
  MAX_PROPOSALS,
  pressure,
  proposalTitle,
  proposeBlocks,
  type Preferences
} from "./planner-proposals";

/** Sunday 20 September 2026, early, before any working morning. */
const NOW = new Date(2026, 8, 20, 4, 0);

const PREFERENCES: Preferences = { ...DEFAULT_PREFERENCES, days: [0, 1, 2, 3, 4, 5, 6] };

function block(start: string, end: string, tag = "projects/ea48"): PlanBlock {
  return {
    uid: `uid-${start}`,
    tag,
    title: "EA48",
    start,
    end,
    calendar: "Berufliches",
    members: []
  };
}

function plan(blocks: PlanBlock[] = [], deadline?: string, capacity?: number): PlanDocument {
  const base = { ...emptyPlan(), blocks };
  if (!deadline) return base;
  return {
    ...base,
    deadlines: {
      "projects/ea48": capacity === undefined ? { date: deadline } : { date: deadline, capacity }
    }
  };
}

function propose(overrides: Partial<Parameters<typeof proposeBlocks>[0]> = {}) {
  return proposeBlocks({
    tag: "projects/ea48",
    deadline: "2026-09-25",
    openTasks: 9,
    plan: plan(),
    busy: [],
    preferences: PREFERENCES,
    now: NOW,
    ...overrides
  });
}

describe("what the planner offers", () => {
  it("proposes one block per capacity of open tasks, earliest first", () => {
    const proposals = propose({ openTasks: 9, preferences: { ...PREFERENCES, capacity: 3 } });

    expect(proposals).toHaveLength(3);
    expect(proposals[0]?.start.getHours()).toBe(5);
    expect(proposals[0]?.start.getMinutes()).toBe(30);
    expect(proposals[0]!.end.getTime() - proposals[0]!.start.getTime()).toBe(60 * 60_000);
    expect(proposals.map((one) => one.start.getDate())).toEqual([20, 21, 22]);
  });

  it("asks for a deadline before it suggests anything", () => {
    expect(propose({ deadline: null })).toEqual([]);
  });

  it("says nothing when there is no open work", () => {
    expect(propose({ openTasks: 0 })).toEqual([]);
  });

  it("never proposes past the deadline", () => {
    const proposals = propose({ deadline: "2026-09-21", openTasks: 30 });
    expect(proposals.map((one) => one.start.getDate())).toEqual([20, 21]);
  });

  it("does not take an all-day event for a busy morning", () => {
    const busy = [{ start: "2026-09-20", end: "2026-09-21", allDay: true }];
    const proposals = propose({ busy, openTasks: 3 });
    expect(proposals[0]?.start.getDate()).toBe(20);
  });

  it("keeps out of time that is already taken", () => {
    const busy = [{ start: "2026-09-20T05:45:00", end: "2026-09-20T06:30:00" }];
    const proposals = propose({ busy, openTasks: 3 });
    expect(proposals[0]?.start.getDate()).toBe(21);
  });

  it("leaves a day that already has a block for this project", () => {
    const existing = plan([block("2026-09-20T09:00:00", "2026-09-20T10:00:00")]);
    const proposals = propose({ plan: existing, openTasks: 3 });
    expect(proposals[0]?.start.getDate()).toBe(21);
  });

  it("keeps a day that only has another project's block", () => {
    const other = plan([block("2026-09-20T09:00:00", "2026-09-20T10:00:00", "projects/lex")]);
    const proposals = propose({ plan: other, openTasks: 3 });
    expect(proposals[0]?.start.getDate()).toBe(20);
  });

  it("keeps out of another project's block at the same hour", () => {
    const other = plan([block("2026-09-20T05:00:00", "2026-09-20T06:00:00", "projects/lex")]);
    const proposals = propose({ plan: other, openTasks: 3 });
    expect(proposals[0]?.start.getDate()).toBe(21);
  });

  it("skips a day of the week that is not for working", () => {
    const proposals = propose({ openTasks: 3, preferences: { ...PREFERENCES, days: [2] } });
    expect(proposals[0]?.start.getDay()).toBe(2);
  });

  it("skips today once its hour has gone by", () => {
    const proposals = propose({ openTasks: 3, now: new Date(2026, 8, 20, 8, 0) });
    expect(proposals[0]?.start.getDate()).toBe(21);
  });

  it("never offers more than a handful of them", () => {
    const proposals = propose({ openTasks: 500, deadline: "2026-12-01" });
    expect(proposals).toHaveLength(MAX_PROPOSALS);
  });
});

describe("how pressing a project is", () => {
  it("counts the days left and the room already planned", () => {
    const existing = plan([block("2026-09-21T05:30:00", "2026-09-21T06:30:00")], "2026-09-25", 3);

    expect(pressure("projects/ea48", existing, 9, 5, NOW)).toEqual({
      tag: "projects/ea48",
      deadline: "2026-09-25",
      daysLeft: 5,
      openTasks: 9,
      plannedBlocks: 1,
      plannedCapacity: 3
    });
  });

  it("ignores blocks that are over, or past the deadline", () => {
    const existing = plan(
      [
        block("2026-09-19T05:30:00", "2026-09-19T06:30:00"),
        block("2026-09-30T05:30:00", "2026-09-30T06:30:00")
      ],
      "2026-09-25"
    );
    expect(pressure("projects/ea48", existing, 4, 3, NOW).plannedBlocks).toBe(0);
  });

  it("has no days left to count without a deadline", () => {
    expect(pressure("projects/ea48", plan(), 4, 3, NOW).daysLeft).toBeNull();
  });
});

describe("naming a block", () => {
  it("uses the tag's last part, with a prefix when there is one", () => {
    expect(proposalTitle("projects/ea48", "")).toBe("EA48");
    expect(proposalTitle("projects/ea48", "Fokus")).toBe("Fokus EA48");
    expect(proposalTitle("lektorat", "")).toBe("LEKTORAT");
  });
});
