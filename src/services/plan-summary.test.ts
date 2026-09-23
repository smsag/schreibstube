import { describe, expect, it } from "vitest";
import { emptyPlan, type PlanBlock, type PlanDocument } from "./plan-model";
import { parsePlanOptions, summarize, timeRange } from "./plan-summary";
import { tasksInNote } from "./task-inventory";

const NOW = new Date(2026, 8, 20, 5, 33);

function block(uid: string, tag: string, start: string, end: string, members: string[]): PlanBlock {
  return {
    uid,
    tag,
    title: tag.toUpperCase(),
    start,
    end,
    calendar: "Berufliches",
    members: members.map((text, index) => ({
      key: `k-${uid}-${index}`,
      text,
      path: "Plan.md",
      remind: index === 0,
      done: text.startsWith("done")
    }))
  };
}

function plan(): PlanDocument {
  return {
    ...emptyPlan(),
    deadlines: { "projects/ea48": { date: "2026-09-25" }, "projects/lex": { date: "2026-09-18" } },
    blocks: [
      block("uid-1", "projects/ea48", "2026-09-20T05:30:00", "2026-09-20T06:00:00", [
        "Datenschutz klären",
        "done: Konzept"
      ]),
      block("uid-2", "projects/lex", "2026-09-21T05:30:00", "2026-09-21T06:00:00", ["Morgen"])
    ]
  };
}

const TASKS = tasksInNote(
  "Plan.md",
  "- [ ] Datenschutz klären #projects/ea48\n- [x] done: Konzept #projects/ea48\n- [ ] Morgen #projects/lex"
);

function summaryOf(source = "", now = NOW) {
  return summarize({
    plan: plan(),
    tasks: TASKS,
    lost: [],
    options: parsePlanOptions(source),
    now
  });
}

describe("the block's own options", () => {
  it("reads the day, the tags and what to show", () => {
    expect(
      parsePlanOptions("day: 2026-09-21\ntags: #projects/ea48, projects/lex\nshow: blocks")
    ).toEqual({ day: "2026-09-21", tags: ["projects/ea48", "projects/lex"], show: "blocks" });
  });

  it("falls back to today and everything, ignoring what it cannot read", () => {
    expect(parsePlanOptions("day: someday\nnonsense\nshow: sideways")).toEqual({
      day: "today",
      tags: [],
      show: "both"
    });
    expect(parsePlanOptions("")).toEqual({ day: "today", tags: [], show: "both" });
  });
});

describe("the day on a start page", () => {
  it("shows the day's blocks with their tasks and what is still open", () => {
    const summary = summaryOf();

    expect(summary.day).toBe("2026-09-20");
    expect(summary.blocks).toHaveLength(1);
    expect(summary.blocks[0]?.tasks.map((task) => task.done)).toEqual([false, true]);
    expect(summary.blocks[0]?.open).toBe(1);
    expect(summary.blocks[0]?.tasks[0]?.remind).toBe(true);
  });

  it("keeps the running block current although its first minutes have passed", () => {
    expect(summaryOf().current?.uid).toBe("uid-1");
    expect(summaryOf().blocks[0]?.live).toBe(true);
  });

  it("shows another day when the block asks for one", () => {
    const summary = summaryOf("day: 2026-09-21");
    expect(summary.blocks[0]?.uid).toBe("uid-2");
  });

  it("keeps only the tags it was given", () => {
    expect(summaryOf("tags: projects/lex").blocks).toEqual([]);
    expect(summaryOf("tags: projects/ea48").blocks).toHaveLength(1);
  });

  it("marks a task the plan holds but the vault no longer shows", () => {
    const summary = summarize({
      plan: plan(),
      tasks: TASKS,
      lost: ["k-uid-1-0"],
      options: parsePlanOptions(""),
      now: NOW
    });
    expect(summary.blocks[0]?.tasks[0]?.lost).toBe(true);
  });
});

describe("the deadlines on a start page", () => {
  it("counts the days left, what is open and what is planned, soonest first", () => {
    const summary = summaryOf();

    expect(summary.deadlines).toEqual([
      {
        tag: "projects/lex",
        date: "2026-09-18",
        daysLeft: -2,
        openTasks: 1,
        plannedTasks: 1
      },
      {
        tag: "projects/ea48",
        date: "2026-09-25",
        daysLeft: 5,
        openTasks: 1,
        plannedTasks: 1
      }
    ]);
  });
});

describe("a block's hours", () => {
  it("reads as a range in the reader's language", () => {
    expect(timeRange("2026-09-20T05:30:00", "2026-09-20T06:00:00", "de")).toContain("–");
  });
});
