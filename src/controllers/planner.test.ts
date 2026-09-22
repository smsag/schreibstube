import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile } from "../testing/obsidian-stub";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { createLogger } from "../services/logger";
import { blockNotes, emptyPlan, taskUrl, type PlanDocument } from "../services/plan-model";
import { PlanConflict } from "../services/plan-protocol";
import type { VaultTask } from "../services/task-inventory";
import type { SchreibstubeSettings } from "../types";

const client = vi.hoisted(() => ({
  fetchHealth: vi.fn(),
  fetchPlan: vi.fn(),
  savePlan: vi.fn(),
  fetchEvents: vi.fn(),
  saveEvent: vi.fn(),
  deleteEvent: vi.fn()
}));

vi.mock("../services/plan-client", () => client);

const { Planner } = await import("./planner");

const NOTE = "- [ ] Datenschutz klären #projects/ea48\n- [ ] Konzept schreiben #projects/ea48";

interface Fake {
  notes: Record<string, string>;
  openFile: ReturnType<typeof vi.fn>;
  /** Resolved before a note is read, so a test can hold a pass mid-scan. */
  gate: Promise<void> | null;
}

function fakeApp(notes: Record<string, string> = { "Plan.md": NOTE }): App & { fake: Fake } {
  const files = new Map(Object.keys(notes).map((path) => [path, new TFile(path)]));
  const fake: Fake = { notes, openFile: vi.fn(async () => undefined), gate: null };
  return {
    fake,
    vault: {
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: TFile) => {
        if (fake.gate) await fake.gate;
        return notes[file.path] ?? "";
      },
      process: async (file: TFile, fn: (data: string) => string) => {
        notes[file.path] = fn(notes[file.path] ?? "");
        return notes[file.path];
      }
    },
    workspace: { getLeaf: () => ({ openFile: fake.openFile }) },
    secretStorage: { getSecret: () => "a-token-long-enough-to-pass" }
  } as unknown as App & { fake: Fake };
}

function settings(overrides: Partial<SchreibstubeSettings> = {}): SchreibstubeSettings {
  return {
    ...DEFAULT_SETTINGS,
    plannerEnabled: true,
    plannerBridgeUrl: "https://bridge.example.de",
    plannerTokenSecretName: "plan-token",
    plannerCalendars: ["Berufliches"],
    ...overrides
  };
}

function planner(app: App, overrides: Partial<SchreibstubeSettings> = {}) {
  return new Planner(
    app,
    () => settings(overrides),
    createLogger(() => false)
  );
}

/**
 * A bridge that behaves like the real one where it matters: it holds one
 * plan at a revision, and refuses a write made against an older one.
 */
function bridge(initial: PlanDocument = emptyPlan()) {
  const held = { rev: 3, plan: initial };
  client.fetchHealth.mockResolvedValue({ version: "2.5.0", protocol: 2, capabilities: ["plan"] });
  client.fetchPlan.mockImplementation(async () => ({ rev: held.rev, plan: held.plan }));
  client.savePlan.mockImplementation(async (_config: unknown, rev: number, plan: PlanDocument) => {
    if (rev !== held.rev) throw new PlanConflict({ rev: held.rev, plan: held.plan });
    held.rev += 1;
    held.plan = plan;
    return { rev: held.rev, plan };
  });
  client.saveEvent.mockResolvedValue("uid-1");
  client.deleteEvent.mockResolvedValue(undefined);
  return held;
}

function draft(tasks: VaultTask[], remind: VaultTask[] = []) {
  return {
    tag: "projects/ea48",
    title: "EA48",
    start: new Date("2026-09-20T05:30:00Z"),
    end: new Date("2026-09-20T06:00:00Z"),
    calendar: "Berufliches",
    tasks,
    remind
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Notice.shown = [];
});

describe("a pass over vault and bridge", () => {
  it("does nothing at all while the planner is off", async () => {
    await planner(fakeApp(), { plannerEnabled: false }).refresh();
    expect(client.fetchPlan).not.toHaveBeenCalled();
  });

  it("reads the vault's tasks and writes nothing when nothing changed", async () => {
    bridge();
    const subject = planner(fakeApp());

    await subject.refresh();

    expect(subject.current().tasks).toHaveLength(2);
    expect(subject.current().error).toBeNull();
    expect(client.savePlan).not.toHaveBeenCalled();
  });

  it("says so when the bridge is older than the planner needs", async () => {
    bridge();
    client.fetchHealth.mockResolvedValue({ version: "2.4.0", protocol: 1, capabilities: ["plan"] });
    const subject = planner(fakeApp());

    await subject.refresh();

    expect(subject.current().error).toContain("protocol 1");
    expect(client.fetchPlan).not.toHaveBeenCalled();
  });

  it("says so when the bridge offers no planning capability", async () => {
    bridge();
    client.fetchHealth.mockResolvedValue({ version: "2.5.0", protocol: 2, capabilities: ["mail"] });
    const subject = planner(fakeApp());

    await subject.refresh();

    expect(subject.current().error).toContain("planning capability");
  });

  it("asks for the version again when the bridge did not answer the first time", async () => {
    bridge();
    client.fetchHealth.mockRejectedValueOnce(new Error("bridge did not respond within 20s."));
    client.fetchHealth.mockResolvedValueOnce({ version: "2.4.0", protocol: 1, capabilities: [] });
    const subject = planner(fakeApp());

    await subject.refresh();
    await subject.refresh();

    expect(subject.current().error).toContain("protocol 1");
    expect(client.fetchPlan).not.toHaveBeenCalled();
  });

  it("says what went wrong instead of throwing", async () => {
    bridge();
    client.fetchPlan.mockRejectedValue(new Error("bridge did not respond within 20s."));
    const subject = planner(fakeApp());

    await subject.refresh();

    expect(subject.current().error).toContain("did not respond");
  });
});

describe("planning a block", () => {
  it("writes the event first, then the plan that points at it", async () => {
    const held = bridge();
    const app = fakeApp();
    const subject = planner(app);
    await subject.refresh();
    const [task] = subject.current().tasks;

    await subject.planBlock(draft([task!], [task!]));

    expect(client.saveEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ calendar: "Berufliches", notes: blockNotes("projects/ea48") })
    );
    expect(held.plan.blocks[0]).toMatchObject({ uid: "uid-1", tag: "projects/ea48" });
    expect(held.plan.blocks[0]?.members[0]).toMatchObject({ remind: true, done: false });
    expect(app.fake.notes["Plan.md"]).toBe(NOTE);
  });

  it("offers a planned task no more, and its identical twin still", async () => {
    bridge();
    const subject = planner(
      fakeApp({ "Plan.md": "- [ ] ping #projects/ea48\n- [ ] ping #projects/ea48" })
    );
    await subject.refresh();
    const [first, second] = subject.current().tasks;

    await subject.planBlock(draft([first!]));
    expect(subject.current().planned.has(first!)).toBe(true);
    await subject.refresh();

    const { planned, tasks } = subject.current();
    expect(planned.has(tasks[0]!)).toBe(true);
    expect(planned.has(tasks[1]!)).toBe(false);
    expect(second).toBeDefined();
  });

  it("keeps a block planned while a refresh was still reading the vault", async () => {
    // An anchor nothing refers to makes the refresh want to write too.
    const held = bridge({
      ...emptyPlan(),
      anchors: { "k-old": { path: "Gone.md", hash: "x", text: "gone", ordinal: 0 } }
    });
    const app = fakeApp();
    const subject = planner(app);
    await subject.refresh();
    held.plan = {
      ...held.plan,
      anchors: { "k-old": { path: "Gone.md", hash: "x", text: "gone", ordinal: 0 } }
    };
    const [task] = subject.current().tasks;

    let release = (): void => undefined;
    app.fake.gate = new Promise<void>((done) => {
      release = done;
    });
    subject.noteChanged("Plan.md");
    const reading = subject.refresh();
    const planning = subject.planBlock(draft([task!]));
    release();
    app.fake.gate = null;
    await Promise.all([reading, planning]);

    expect(held.plan.blocks).toHaveLength(1);
    expect(subject.current().plan.blocks).toHaveLength(1);
  });

  it("takes the event out again when the plan cannot be stored", async () => {
    bridge();
    const subject = planner(fakeApp());
    await subject.refresh();
    const [task] = subject.current().tasks;
    client.savePlan.mockRejectedValue(new Error("bridge returned 400"));

    await subject.planBlock(draft([task!]));

    expect(client.deleteEvent).toHaveBeenCalledWith(expect.anything(), "uid-1", "Berufliches");
    expect(subject.current().plan.blocks).toEqual([]);
    expect(Notice.shown.at(-1)).toContain("400");
  });

  it("takes a block out of the plan before taking its event out of the calendar", async () => {
    const held = bridge();
    const subject = planner(fakeApp());
    await subject.refresh();
    await subject.planBlock(draft([subject.current().tasks[0]!]));

    await subject.dropBlock("uid-1");

    expect(held.plan.blocks).toEqual([]);
    expect(client.deleteEvent).toHaveBeenCalledWith(expect.anything(), "uid-1", "Berufliches");
  });
});

describe("changing the plan", () => {
  it("redoes its change on the newer plan when the bridge has moved on", async () => {
    const held = bridge();
    const subject = planner(fakeApp());
    await subject.refresh();
    held.plan = { ...emptyPlan(), deadlines: { "projects/lex": { date: "2026-10-01" } } };
    held.rev = 12;

    await subject.setTagDeadline("projects/ea48", "2026-09-25", 3);

    expect(held.plan.deadlines).toEqual({
      "projects/lex": { date: "2026-10-01" },
      "projects/ea48": { date: "2026-09-25", capacity: 3 }
    });
  });

  it("shows nothing it could not store, and says why", async () => {
    bridge();
    const subject = planner(fakeApp());
    await subject.refresh();
    client.savePlan.mockRejectedValue(new Error("bridge returned 400"));

    await subject.setTagDeadline("projects/ea48", "2026-09-25", 3);

    expect(subject.current().plan.deadlines).toEqual({});
    expect(subject.current().error).toContain("400");
  });

  it("writes nothing for a rename the plan does not refer to", async () => {
    bridge();
    const subject = planner(fakeApp());
    await subject.refresh();

    await subject.noteRenamed("Other.md", "Elsewhere.md");

    expect(client.savePlan).not.toHaveBeenCalled();
  });

  it("follows a rename the plan does refer to", async () => {
    const held = bridge();
    const subject = planner(fakeApp());
    await subject.refresh();
    await subject.planBlock(draft([subject.current().tasks[0]!]));

    await subject.noteRenamed("Plan.md", "Archiv/Plan.md");

    expect(Object.values(held.plan.anchors).map((anchor) => anchor.path)).toEqual([
      "Archiv/Plan.md"
    ]);
  });
});

describe("reminders", () => {
  it("queues a reminder for a marked task, and nothing for the others", async () => {
    const held = bridge();
    const subject = planner(fakeApp());
    await subject.refresh();
    const [first, second] = subject.current().tasks;

    await subject.planBlock(draft([first!, second!], [first!]));
    await subject.refresh();

    expect(held.plan.queue).toHaveLength(1);
    expect(held.plan.queue[0]).toMatchObject({
      op: "upsert",
      title: "Datenschutz klären #projects/ea48"
    });
    expect(held.plan.queue[0]?.notes).toContain(taskUrl(held.plan.queue[0]!.key));
  });

  it("ticks a task in its note when a drain reports it done, and shows it ticked", async () => {
    const held = bridge();
    const app = fakeApp();
    const subject = planner(app);
    await subject.refresh();
    await subject.planBlock(draft([subject.current().tasks[0]!], [subject.current().tasks[0]!]));
    const key = held.plan.blocks[0]!.members[0]!.key;
    held.plan = { ...held.plan, completions: [{ key, done: true, at: "2026-09-20T07:00:00Z" }] };

    await subject.refresh();

    expect(app.fake.notes["Plan.md"]).toBe(
      "- [x] Datenschutz klären #projects/ea48\n- [ ] Konzept schreiben #projects/ea48"
    );
    expect(held.plan.completions).toEqual([]);
    expect(subject.current().tasks[0]?.done).toBe(true);
    expect(held.plan.blocks[0]?.members[0]?.done).toBe(true);
    expect(held.plan.queue[0]).toMatchObject({ done: true });
  });
});

describe("reminders the Erinnerungen sync already keeps", () => {
  it("are left to it, so a task is not reminded twice", async () => {
    const held = bridge();
    const note = "- [ ] Call #remind #projects/ea48\n- [ ] Write #projects/ea48";
    const subject = planner(fakeApp({ "Plan.md": note }), { remindersEnabled: true });
    await subject.refresh();
    const [synced, plain] = subject.current().tasks;

    await subject.planBlock(draft([synced!, plain!], [synced!, plain!]));
    await subject.refresh();

    expect(held.plan.queue.map((op) => op.title)).toEqual(["Write #projects/ea48"]);
  });

  it("are the planner's to send while the sync is off", async () => {
    const held = bridge();
    const subject = planner(fakeApp({ "Plan.md": "- [ ] Call #remind #projects/ea48" }));
    await subject.refresh();
    const [task] = subject.current().tasks;

    await subject.planBlock(draft([task!], [task!]));
    await subject.refresh();

    expect(held.plan.queue).toHaveLength(1);
  });
});

describe("the way back from a reminder", () => {
  it("opens the note on the task's line", async () => {
    bridge();
    const app = fakeApp({ "Other.md": "nothing", "Plan.md": NOTE });
    const subject = planner(app);
    await subject.refresh();
    await subject.planBlock(draft([subject.current().tasks[1]!]));
    const key = subject.current().plan.blocks[0]!.members[0]!.key;

    await subject.openKey(key);

    expect(app.fake.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Plan.md" }), {
      eState: { line: 1 }
    });
  });

  it("waits for the plan when the link is what started Obsidian", async () => {
    const held = bridge();
    const setup = planner(fakeApp());
    await setup.refresh();
    await setup.planBlock(draft([setup.current().tasks[1]!]));
    const key = held.plan.blocks[0]!.members[0]!.key;

    const app = fakeApp();
    await planner(app).openKey(key);

    expect(app.fake.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Plan.md" }), {
      eState: { line: 1 }
    });
  });

  it("says so when no note holds the task any more", async () => {
    bridge();
    const subject = planner(fakeApp());
    await subject.refresh();

    await subject.openKey("k-unknown");

    expect(Notice.shown.at(-1)).toContain("no note");
  });

  it("does nothing while the planner is off", async () => {
    const app = fakeApp();
    await planner(app, { plannerEnabled: false }).openKey("k-any");
    expect(app.fake.openFile).not.toHaveBeenCalled();
    expect(Notice.shown).toEqual([]);
  });
});
