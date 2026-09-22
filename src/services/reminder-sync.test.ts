import { describe, expect, it } from "vitest";
import {
  buildOutbox,
  emptyState,
  MAX_INBOX_REMINDERS,
  parseInbox,
  parseState,
  reconcile,
  signature,
  uniqueTasks,
  type Inbox,
  type SyncState
} from "./reminder-sync";
import { taskLink, type NoteTask } from "./reminder-tasks";

function task(id: string, overrides: Partial<NoteTask> = {}): NoteTask {
  return {
    id,
    path: "Plan.md",
    line: 0,
    title: `Task ${id}`,
    notes: `↩ Plan\n${taskLink(id)}`,
    due: null,
    done: false,
    ...overrides
  };
}

function inbox(appliedSeq: number, at: number, reminders: [string, boolean][]): Inbox {
  return { appliedSeq, at, reminders: reminders.map(([id, done]) => ({ id, done, title: "" })) };
}

/** The state after a task was sent and the Shortcut confirmed it. */
function synced(...tasks: NoteTask[]): SyncState {
  const sent = reconcile({ tasks, inbox: null, state: emptyState() }).state;
  const ids = tasks.map((t): [string, boolean] => [t.id, false]);
  return reconcile({ tasks, inbox: inbox(sent.seq, 1000, ids), state: sent }).state;
}

describe("sending tasks", () => {
  it("creates a reminder for a new open task and remembers it", () => {
    const { state, changes } = reconcile({
      tasks: [task("r-a")],
      inbox: null,
      state: emptyState()
    });

    expect(state.seq).toBe(1);
    expect(state.pending["r-a"]).toEqual({
      op: "upsert",
      id: "r-a",
      match: "task=r-a&",
      title: "Task r-a",
      notes: `↩ Plan\n${taskLink("r-a")}`,
      due: null
    });
    expect(state.known["r-a"]).toMatchObject({ done: false, since: 1, detached: false });
    expect(changes).toEqual([]);
  });

  it("does not create a reminder for a task that is already done", () => {
    const { state } = reconcile({
      tasks: [task("r-a", { done: true })],
      inbox: null,
      state: emptyState()
    });
    expect(state.seq).toBe(0);
    expect(state.known).toEqual({});
  });

  it("does nothing on a second pass with nothing changed", () => {
    const first = reconcile({ tasks: [task("r-a")], inbox: null, state: emptyState() }).state;
    const second = reconcile({ tasks: [task("r-a")], inbox: null, state: first }).state;
    expect(second).toEqual(first);
  });

  it("clears the outbox once the Shortcut confirms it applied it", () => {
    const state = synced(task("r-a"));
    expect(state.pending).toEqual({});
    expect(buildOutbox(state, "Schreibstube")).toEqual({
      v: 1,
      seq: 1,
      list: "Schreibstube",
      ops: []
    });
  });

  it("sends an edit of the title, notes or due date without touching completion", () => {
    const state = synced(task("r-a"));
    const edited = task("r-a", { title: "New", due: "2026-10-01" });

    const next = reconcile({ tasks: [edited], inbox: null, state }).state;

    expect(next.pending["r-a"]).toMatchObject({ op: "upsert", title: "New", due: "2026-10-01" });
    expect(next.pending["r-a"]).not.toHaveProperty("done");
    expect(next.known["r-a"]?.sig).toBe(signature(edited));
  });

  it("sends a tick made in the note", () => {
    const state = synced(task("r-a"));
    const next = reconcile({ tasks: [task("r-a", { done: true })], inbox: null, state }).state;
    expect(next.pending["r-a"]).toMatchObject({ op: "upsert", done: true });
    expect(next.known["r-a"]?.done).toBe(true);
  });

  it("keeps an unconfirmed tick when the task is edited again before the Shortcut runs", () => {
    const state = synced(task("r-a"));
    const ticked = reconcile({ tasks: [task("r-a", { done: true })], inbox: null, state }).state;
    const edited = reconcile({
      tasks: [task("r-a", { done: true, title: "Renamed" })],
      inbox: null,
      state: ticked
    }).state;
    expect(edited.pending["r-a"]).toMatchObject({ title: "Renamed", done: true });
  });

  it("deletes the reminder of a task that is gone", () => {
    const state = synced(task("r-a"), task("r-b"));
    const next = reconcile({ tasks: [task("r-b")], inbox: null, state }).state;
    expect(next.pending["r-a"]).toEqual({ op: "delete", id: "r-a", match: "task=r-a&" });
    expect(next.known["r-a"]).toBeUndefined();
  });
});

describe("what comes back", () => {
  it("ticks a task whose reminder was completed", () => {
    const state = synced(task("r-a"));
    const { state: next, changes } = reconcile({
      tasks: [task("r-a")],
      inbox: inbox(1, 2000, [["r-a", true]]),
      state
    });
    expect(changes).toEqual([{ id: "r-a", path: "Plan.md", done: true }]);
    expect(next.known["r-a"]?.done).toBe(true);
    expect(next.pending).toEqual({});
  });

  it("reopens a task whose reminder was reopened", () => {
    const state = synced(task("r-a"));
    const done = reconcile({
      tasks: [task("r-a")],
      inbox: inbox(1, 2000, [["r-a", true]]),
      state
    }).state;
    const { changes } = reconcile({
      tasks: [task("r-a", { done: true })],
      inbox: inbox(1, 3000, [["r-a", false]]),
      state: done
    });
    expect(changes).toEqual([{ id: "r-a", path: "Plan.md", done: false }]);
  });

  it("sends nothing when both sides ticked the same task", () => {
    const state = synced(task("r-a"));
    const { state: next, changes } = reconcile({
      tasks: [task("r-a", { done: true })],
      inbox: inbox(1, 2000, [["r-a", true]]),
      state
    });
    expect(changes).toEqual([]);
    expect(next.pending).toEqual({});
    expect(next.known["r-a"]?.done).toBe(true);
  });

  it("reads a snapshot once, so an old one cannot undo a later tick", () => {
    const state = synced(task("r-a"));
    const stale = inbox(1, 1000, [["r-a", false]]);
    const next = reconcile({ tasks: [task("r-a", { done: true })], inbox: stale, state });
    expect(next.changes).toEqual([]);
    expect(next.state.pending["r-a"]).toMatchObject({ done: true });
  });

  it("ignores what a snapshot says about a reminder it cannot have seen yet", () => {
    const state = synced(task("r-a"));
    const edited = reconcile({ tasks: [task("r-a", { title: "New" })], inbox: null, state }).state;
    // Taken before the Shortcut applied sequence 2: the reminder still looks
    // open and unchanged, and its absence would mean nothing either.
    const {
      state: next,
      changes,
      detached
    } = reconcile({
      tasks: [task("r-a", { title: "New" })],
      inbox: inbox(1, 5000, []),
      state: edited
    });
    expect(changes).toEqual([]);
    expect(detached).toEqual([]);
    expect(next.pending["r-a"]).toBeDefined();
  });
});

describe("a reminder deleted in Reminders", () => {
  it("detaches its task, which is not sent again", () => {
    const state = synced(task("r-a"), task("r-b"));
    const { state: next, detached } = reconcile({
      tasks: [task("r-a"), task("r-b")],
      inbox: inbox(1, 2000, [["r-b", false]]),
      state
    });
    expect(detached).toEqual(["r-a"]);
    expect(next.known["r-a"]?.detached).toBe(true);
    expect(next.pending).toEqual({});

    const again = reconcile({ tasks: [task("r-a"), task("r-b")], inbox: null, state: next });
    expect(again.state.pending).toEqual({});
  });

  it("sends it again once the task is edited", () => {
    const state = synced(task("r-a"), task("r-b"));
    const detached = reconcile({
      tasks: [task("r-a"), task("r-b")],
      inbox: inbox(1, 2000, [["r-b", false]]),
      state
    }).state;
    const next = reconcile({
      tasks: [task("r-a", { title: "Again" }), task("r-b")],
      inbox: null,
      state: detached
    }).state;
    expect(next.pending["r-a"]).toMatchObject({ op: "upsert", title: "Again", done: false });
    expect(next.known["r-a"]?.detached).toBe(false);
  });

  it("does not delete anything when its task goes too", () => {
    const state = synced(task("r-a"), task("r-b"));
    const detached = reconcile({
      tasks: [task("r-a"), task("r-b")],
      inbox: inbox(1, 2000, [["r-b", false]]),
      state
    }).state;
    const next = reconcile({ tasks: [task("r-b")], inbox: null, state: detached }).state;
    expect(next.pending).toEqual({});
    expect(next.known["r-a"]).toBeUndefined();
  });

  it("takes an empty list for a list the Shortcut could not find, not a mass deletion", () => {
    const state = synced(task("r-a"));
    const { detached } = reconcile({ tasks: [task("r-a")], inbox: inbox(1, 2000, []), state });
    expect(detached).toEqual([]);
  });
});

describe("tasks with the same id", () => {
  it("keeps the first and names the rest", () => {
    const first = task("r-a");
    const copy = task("r-a", { path: "Other.md" });
    expect(uniqueTasks([first, task("r-b"), copy])).toEqual({
      tasks: [first, task("r-b")],
      duplicates: [copy]
    });
  });
});

describe("reading the inbox", () => {
  it("reads the reminders that carry a task link, whatever Shortcuts made of the fields", () => {
    const raw = JSON.stringify({
      appliedSeq: "3",
      at: "2026-09-18T10:00:00Z",
      reminders: [
        { notes: `body\n${taskLink("r-a")}`, done: "Yes", title: "A" },
        { notes: `obsidian://schreibstube?task=old123`, done: 1 },
        { notes: "added by hand", done: true },
        { notes: taskLink("r-a"), done: false },
        "nonsense"
      ]
    });

    expect(parseInbox(raw)).toEqual({
      appliedSeq: 3,
      at: Date.parse("2026-09-18T10:00:00Z"),
      reminders: [
        { id: "r-a", done: true, title: "A" },
        { id: "old123", done: true, title: "" }
      ]
    });
  });

  it("refuses what is not an inbox", () => {
    expect(parseInbox("not json")).toBeNull();
    expect(parseInbox("[]")).toBeNull();
    expect(parseInbox("{}")).toBeNull();
  });

  it("reads a missing or unreadable time and sequence as zero", () => {
    expect(parseInbox(JSON.stringify({ at: "yesterday", appliedSeq: -2, reminders: [] }))).toEqual({
      appliedSeq: 0,
      at: 0,
      reminders: []
    });
  });

  it("reads no more reminders than the bound", () => {
    const reminders = Array.from({ length: MAX_INBOX_REMINDERS + 10 }, (_, index) => ({
      notes: taskLink(`r-${index}`)
    }));
    expect(parseInbox(JSON.stringify({ reminders }))?.reminders).toHaveLength(MAX_INBOX_REMINDERS);
  });
});

describe("reading the state", () => {
  it("round-trips what reconcile writes", () => {
    const state = reconcile({
      tasks: [task("r-a", { due: "2026-09-20" })],
      inbox: null,
      state: synced(task("r-b"))
    }).state;
    expect(parseState(JSON.stringify(state))).toEqual(state);
  });

  it("starts empty from a missing or damaged file", () => {
    expect(parseState(null)).toEqual(emptyState());
    expect(parseState("{")).toEqual(emptyState());
    expect(parseState("[1]")).toEqual(emptyState());
  });

  it("drops entries it cannot trust", () => {
    const raw = JSON.stringify({
      seq: 4,
      observedAt: 10,
      pending: {
        a: { op: "upsert", id: "r-a", title: "T", notes: "N", due: "soon", done: "yes" },
        b: { op: "delete", id: "r-b" },
        c: { op: "explode", id: "r-c" },
        d: { op: "delete", id: "../x" }
      },
      known: { "r-a": { done: true, sig: "s", since: 2 }, "bad id": { done: true }, "r-z": 3 }
    });
    expect(parseState(raw)).toEqual({
      v: 1,
      seq: 4,
      observedAt: 10,
      pending: {
        "r-a": { op: "upsert", id: "r-a", match: "task=r-a&", title: "T", notes: "N", due: null },
        "r-b": { op: "delete", id: "r-b", match: "task=r-b&" }
      },
      known: { "r-a": { done: true, sig: "s", since: 2, detached: false } }
    });
  });
});
