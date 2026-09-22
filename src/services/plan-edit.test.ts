import { describe, expect, it } from "vitest";
import {
  emptyPlan,
  MAX_QUEUE,
  type PlanBlock,
  type PlanDocument,
  type QueueOp
} from "./plan-model";
import {
  applyMatch,
  buildQueue,
  keysForTasks,
  plannedTasks,
  pruneAnchors,
  removeBlock,
  setDeadline,
  setTaskDone,
  takeCompletions,
  upsertBlock,
  type ReminderFields
} from "./plan-edit";
import { matchAnchors } from "./task-identity";
import { tasksInNote, type VaultTask } from "./task-inventory";

const NOTE = "- [ ] Datenschutz klären #projects/ea48\n- [ ] Konzept schreiben #projects/ea48";

function scan(note = NOTE, path = "Plan.md"): VaultTask[] {
  return tasksInNote(path, note);
}

/** A plan with both tasks planned into one block, keyed k-1 and k-2. */
function planned(tasks = scan()): { plan: PlanDocument; block: PlanBlock } {
  let index = 0;
  const keyed = keysForTasks(emptyPlan(), tasks, () => `k-${(index += 1)}`);
  const block: PlanBlock = {
    uid: "uid-1",
    tag: "projects/ea48",
    title: "EA48",
    start: "2026-09-20T05:30:00+02:00",
    end: "2026-09-20T06:00:00+02:00",
    calendar: "Berufliches",
    members: tasks.map((task) => ({
      key: keyed.keys.get(task)!,
      text: task.text,
      path: task.path,
      remind: false,
      done: task.done
    }))
  };
  return { plan: upsertBlock(keyed.plan, block), block };
}

describe("deadlines and blocks", () => {
  it("sets, replaces and clears a project's deadline", () => {
    let plan = setDeadline(emptyPlan(), "projects/ea48", "2026-09-25", 3);
    expect(plan.deadlines["projects/ea48"]).toEqual({ date: "2026-09-25", capacity: 3 });

    plan = setDeadline(plan, "projects/ea48", "2026-09-26");
    expect(plan.deadlines["projects/ea48"]).toEqual({ date: "2026-09-26" });

    plan = setDeadline(plan, "projects/ea48", null);
    expect(plan.deadlines).toEqual({});
  });

  it("replaces the block with the same event rather than adding a second", () => {
    const { plan, block } = planned();
    const next = upsertBlock(plan, { ...block, title: "EA48, again" });
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]?.title).toBe("EA48, again");
  });

  it("removes a block", () => {
    const { plan } = planned();
    expect(removeBlock(plan, "uid-1").blocks).toEqual([]);
  });

  it("keeps a deadline's capacity to what the bridge will store", () => {
    expect(setDeadline(emptyPlan(), "p", "2026-09-25", 100).deadlines.p?.capacity).toBe(50);
    expect(setDeadline(emptyPlan(), "p", "2026-09-25", 2.5).deadlines.p?.capacity).toBe(3);
  });
});

describe("keys for tasks", () => {
  it("gives a new task a key and keeps the one a known task has", () => {
    const tasks = scan();
    let index = 0;
    const first = keysForTasks(emptyPlan(), tasks, () => `k-${(index += 1)}`);
    const again = keysForTasks(first.plan, [tasks[0]!], () => "k-never");

    expect(again.keys.get(tasks[0]!)).toBe(first.keys.get(tasks[0]!));
    expect(Object.keys(again.plan.anchors)).toHaveLength(Object.keys(first.plan.anchors).length);
  });
});

describe("the plan after a fresh scan", () => {
  it("follows an edited task and takes completion from the note", () => {
    const { plan } = planned();
    const edited = scan(
      "- [x] Datenschutz-Fragen mit Legal klären #projects/ea48\n- [ ] Konzept schreiben #projects/ea48"
    );

    const next = applyMatch(plan, matchAnchors(plan.anchors, edited));

    expect(next.blocks[0]?.members[0]).toMatchObject({
      text: "Datenschutz-Fragen mit Legal klären #projects/ea48",
      done: true
    });
  });

  it("keeps a member whose task is missing, rather than dropping it", () => {
    const { plan } = planned();
    const match = matchAnchors(plan.anchors, scan("- [ ] Konzept schreiben #projects/ea48"));

    const next = applyMatch(plan, match);

    expect(match.lost).toHaveLength(1);
    expect(next.blocks[0]?.members).toHaveLength(2);
  });

  it("forgets anchors nothing refers to any more", () => {
    const { plan } = planned();
    const next = pruneAnchors(removeBlock(plan, "uid-1"));
    expect(next.anchors).toEqual({});
  });
});

describe("the reminder queue", () => {
  const fields = (overrides: Partial<ReminderFields> = {}): ReminderFields => ({
    title: "Datenschutz klären",
    notes: "↩ Plan",
    due: null,
    done: false,
    ...overrides
  });

  it("adds an operation for a task marked for Reminders", () => {
    const { plan } = planned();
    const next = buildQueue(plan, new Map([["k-1", fields()]]), "Schreibstube");

    expect(next.queue).toEqual([
      {
        seq: 1,
        op: "upsert",
        key: "k-1",
        title: "Datenschutz klären",
        notes: "↩ Plan",
        due: null,
        done: false,
        list: "Schreibstube"
      }
    ]);
  });

  it("adds nothing when Reminders already holds what it should", () => {
    const { plan } = planned();
    const desired = new Map([["k-1", fields()]]);
    const once = buildQueue(plan, desired, "Schreibstube");
    expect(buildQueue(once, desired, "Schreibstube")).toBe(once);
  });

  it("sends the change when the task was edited, ticked or dated", () => {
    const { plan } = planned();
    const once = buildQueue(plan, new Map([["k-1", fields()]]), "Schreibstube");

    const ticked = buildQueue(once, new Map([["k-1", fields({ done: true })]]), "Schreibstube");
    expect(ticked.queue.at(-1)).toMatchObject({ seq: 2, done: true });

    const dated = buildQueue(
      ticked,
      new Map([["k-1", fields({ done: true, due: "2026-09-25" })]]),
      "Schreibstube"
    );
    expect(dated.queue.at(-1)).toMatchObject({ seq: 3, due: "2026-09-25" });
    expect(dated.queue.filter((op) => op.key === "k-1")).toHaveLength(1);
  });

  it("removes the reminder of a task that is no longer marked", () => {
    const { plan } = planned();
    const once = buildQueue(plan, new Map([["k-1", fields()]]), "Schreibstube");

    const dropped = buildQueue(once, new Map(), "Schreibstube");

    expect(dropped.queue.at(-1)).toEqual({ seq: 2, op: "delete", key: "k-1" });
    expect(buildQueue(dropped, new Map(), "Schreibstube")).toBe(dropped);
  });
});

describe("the reminder queue, when a task cannot be found", () => {
  const fields = (): ReminderFields => ({
    title: "Datenschutz klären",
    notes: "↩ Plan",
    due: null,
    done: false
  });

  it("leaves the reminder of a task it could not find this pass alone", () => {
    const { plan } = planned();
    const once = buildQueue(plan, new Map([["k-1", fields()]]), "Schreibstube");

    const next = buildQueue(once, new Map(), "Schreibstube", new Set(["k-1"]));

    expect(next).toBe(once);
  });

  it("never pushes out the record of a reminder that may still exist", () => {
    const queue: QueueOp[] = Array.from({ length: MAX_QUEUE }, (_, index) => ({
      seq: index + 1,
      op: "upsert" as const,
      key: `k-live-${index}`,
      title: "t",
      notes: "n",
      due: null,
      done: false,
      list: "L"
    }));
    const full = { ...emptyPlan(), queue, acked: MAX_QUEUE };
    const desired = new Map<string, ReminderFields>(
      queue.map((op) => [op.key, { title: "t", notes: "n", due: null, done: false }])
    );
    desired.set("k-new", fields());

    const next = buildQueue(full, desired, "L");

    expect(next.queue).toHaveLength(MAX_QUEUE);
    expect(next.queue.some((op) => op.key === "k-new")).toBe(false);
    expect(next.queue.every((op) => op.key.startsWith("k-live-"))).toBe(true);
  });

  it("makes room from deletes a drain has already applied", () => {
    const queue: QueueOp[] = Array.from({ length: MAX_QUEUE }, (_, index) => ({
      seq: index + 1,
      op: "delete" as const,
      key: `k-gone-${index}`
    }));
    const full = { ...emptyPlan(), queue, acked: MAX_QUEUE };

    const next = buildQueue(full, new Map([["k-new", fields()]]), "L");

    expect(next.queue.map((op) => op.key)).toEqual(["k-new"]);
  });
});

describe("tasks already planned", () => {
  it("are found by key, not by wording, and a done one is free again", () => {
    const tasks = scan(
      "- [ ] ping #projects/ea48\n- [ ] ping #projects/ea48\n- [x] pong #projects/ea48"
    );
    const { plan } = planned([tasks[0]!, tasks[2]!]);
    const match = matchAnchors(plan.anchors, tasks);

    const taken = plannedTasks(plan, match.bound);

    expect(taken.has(tasks[0]!)).toBe(true);
    expect(taken.has(tasks[1]!)).toBe(false);
    expect(taken.has(tasks[2]!)).toBe(false);
  });
});

describe("ticking a note", () => {
  it("ticks an open box and reopens an x, keeping the line endings", () => {
    const note = "- [ ] a\r\n- [x] b\r\n- [ ] c";
    expect(
      setTaskDone(note, [
        { line: 0, done: true },
        { line: 1, done: false }
      ])
    ).toEqual({
      content: "- [x] a\r\n- [ ] b\r\n- [ ] c",
      changed: 2
    });
  });

  it("leaves a box someone marked otherwise alone", () => {
    const note = "- [-] cancelled\n- [>] deferred";
    expect(
      setTaskDone(note, [
        { line: 0, done: false },
        { line: 1, done: true }
      ])
    ).toEqual({
      content: note,
      changed: 0
    });
  });

  it("ignores a line that is not there any more", () => {
    expect(setTaskDone("- [ ] a", [{ line: 5, done: true }]).changed).toBe(0);
  });
});

describe("what a drain reported from Reminders", () => {
  it("ticks the task in its note and consumes the completion", () => {
    const { plan } = planned();
    const tasks = scan();
    const match = matchAnchors(plan.anchors, tasks);
    const withCompletion = {
      ...plan,
      completions: [{ key: "k-1", done: true, at: "2026-09-20T07:00:00Z" }]
    };

    const { plan: next, edits } = takeCompletions(withCompletion, match.bound);

    expect(edits).toEqual([{ path: "Plan.md", line: 0, done: true }]);
    expect(next.completions).toEqual([]);
  });

  it("keeps a completion whose task has not reached this device yet", () => {
    const { plan } = planned();
    const withCompletion = {
      ...plan,
      completions: [{ key: "k-9", done: true, at: "2026-09-20T07:00:00Z" }]
    };

    const { plan: next, edits } = takeCompletions(withCompletion, new Map());

    expect(edits).toEqual([]);
    expect(next.completions).toHaveLength(1);
  });

  it("says nothing when the note already agrees", () => {
    const tasks = scan("- [x] Datenschutz klären #projects/ea48");
    const { plan } = planned(tasks);
    const match = matchAnchors(plan.anchors, tasks);

    const { edits } = takeCompletions(
      { ...plan, completions: [{ key: "k-1", done: true, at: "now" }] },
      match.bound
    );

    expect(edits).toEqual([]);
  });
});
