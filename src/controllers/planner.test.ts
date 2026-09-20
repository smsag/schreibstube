import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile } from "../testing/obsidian-stub";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { createLogger } from "../services/logger";
import { emptyPlan, type PlanDocument } from "../services/plan-model";
import { PlanConflict } from "../services/plan-protocol";
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

const { Planner, blockNotes, blockTag, taskUrl } = await import("./planner");

const NOTE = "- [ ] Datenschutz klären #projects/ea48\n- [ ] Konzept schreiben #projects/ea48";

interface Fake {
  notes: Record<string, string>;
  openFile: ReturnType<typeof vi.fn>;
}

function fakeApp(notes: Record<string, string> = { "Plan.md": NOTE }): App & { fake: Fake } {
  const files = new Map(Object.keys(notes).map((path) => [path, new TFile(path)]));
  const fake: Fake = { notes, openFile: vi.fn(async () => undefined) };
  return {
    fake,
    vault: {
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: TFile) => notes[file.path] ?? "",
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

/** What the bridge holds before a pass. */
function stored(plan: PlanDocument = emptyPlan(), rev = 3) {
  client.fetchHealth.mockResolvedValue({ protocol: 2, capabilities: ["plan"] });
  client.fetchPlan.mockResolvedValue({ rev, plan });
  client.savePlan.mockImplementation(async (_config: unknown, revision: number) => ({
    rev: revision + 1,
    plan
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Notice.shown = [];
});

describe("a pass over vault and bridge", () => {
  it("does nothing at all while the planner is off", async () => {
    const app = fakeApp();
    await planner(app, { plannerEnabled: false }).refresh();
    expect(client.fetchPlan).not.toHaveBeenCalled();
  });

  it("reads the vault's tasks and keeps the plan as it was when nothing changed", async () => {
    stored();
    const app = fakeApp();
    const subject = planner(app);

    await subject.refresh();

    expect(subject.current().tasks).toHaveLength(2);
    expect(subject.current().error).toBeNull();
    expect(client.savePlan).not.toHaveBeenCalled();
  });

  it("says so when the bridge is older than the planner needs", async () => {
    client.fetchHealth.mockResolvedValue({ protocol: 1, capabilities: ["plan"] });
    const subject = planner(fakeApp());

    await subject.refresh();

    expect(subject.current().error).toContain("protocol 1");
    expect(client.fetchPlan).not.toHaveBeenCalled();
  });

  it("says so when the bridge offers no planning capability", async () => {
    client.fetchHealth.mockResolvedValue({ protocol: 2, capabilities: ["mail"] });
    const subject = planner(fakeApp());

    await subject.refresh();

    expect(subject.current().error).toContain("planning capability");
  });

  it("says what went wrong instead of throwing", async () => {
    client.fetchHealth.mockResolvedValue({ protocol: 2, capabilities: ["plan"] });
    client.fetchPlan.mockRejectedValue(new Error("bridge did not respond within 20s."));
    const subject = planner(fakeApp());

    await subject.refresh();

    expect(subject.current().error).toContain("did not respond");
  });

  it("plans a block: the event first, then the plan that points at it", async () => {
    stored();
    client.saveEvent.mockResolvedValue("uid-1");
    const app = fakeApp();
    const subject = planner(app);
    await subject.refresh();
    const [task] = subject.current().tasks;

    await subject.planBlock({
      tag: "projects/ea48",
      title: "EA48",
      start: new Date("2026-09-20T05:30:00Z"),
      end: new Date("2026-09-20T06:00:00Z"),
      calendar: "Berufliches",
      tasks: [task!],
      remind: [task!]
    });

    expect(client.saveEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ calendar: "Berufliches", notes: blockNotes("projects/ea48") })
    );
    const written = client.savePlan.mock.calls.at(-1)?.[2] as PlanDocument;
    expect(written.blocks[0]).toMatchObject({ uid: "uid-1", tag: "projects/ea48" });
    expect(written.blocks[0]?.members[0]).toMatchObject({ remind: true, done: false });
    expect(app.fake.notes["Plan.md"]).toBe(NOTE);
  });

  it("queues a reminder for a marked task, and nothing for the others", async () => {
    stored();
    client.saveEvent.mockResolvedValue("uid-1");
    const subject = planner(fakeApp());
    await subject.refresh();
    const [first, second] = subject.current().tasks;

    await subject.planBlock({
      tag: "projects/ea48",
      title: "EA48",
      start: new Date("2026-09-20T05:30:00Z"),
      end: new Date("2026-09-20T06:00:00Z"),
      calendar: "Berufliches",
      tasks: [first!, second!],
      remind: [first!]
    });
    client.fetchPlan.mockResolvedValue({
      rev: 9,
      plan: client.savePlan.mock.calls.at(-1)?.[2] as PlanDocument
    });
    await subject.refresh(true);

    const queue = subject.current().plan.queue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ op: "upsert", title: "Datenschutz klären #projects/ea48" });
    expect(queue[0]?.notes).toContain(taskUrl(queue[0]!.key));
  });

  it("ticks a task in its note when a drain reports it done", async () => {
    stored();
    client.saveEvent.mockResolvedValue("uid-1");
    const app = fakeApp();
    const subject = planner(app);
    await subject.refresh();
    const [task] = subject.current().tasks;
    await subject.planBlock({
      tag: "projects/ea48",
      title: "EA48",
      start: new Date("2026-09-20T05:30:00Z"),
      end: new Date("2026-09-20T06:00:00Z"),
      calendar: "Berufliches",
      tasks: [task!],
      remind: [task!]
    });

    const withCompletion = client.savePlan.mock.calls.at(-1)?.[2] as PlanDocument;
    const key = withCompletion.blocks[0]!.members[0]!.key;
    client.fetchPlan.mockResolvedValue({
      rev: 9,
      plan: { ...withCompletion, completions: [{ key, done: true, at: "2026-09-20T07:00:00Z" }] }
    });

    await subject.refresh(true);

    expect(app.fake.notes["Plan.md"]).toBe(
      "- [x] Datenschutz klären #projects/ea48\n- [ ] Konzept schreiben #projects/ea48"
    );
    expect(subject.current().plan.completions).toEqual([]);
  });

  it("redoes its change on the newer plan when the bridge has moved on", async () => {
    stored();
    const app = fakeApp();
    const subject = planner(app);
    await subject.refresh();

    const newer = { ...emptyPlan(), deadlines: { "projects/lex": { date: "2026-10-01" } } };
    client.savePlan.mockRejectedValueOnce(new PlanConflict({ rev: 12, plan: newer }));
    client.savePlan.mockResolvedValueOnce({ rev: 13, plan: newer });

    await subject.setTagDeadline("projects/ea48", "2026-09-25", 3);

    const written = client.savePlan.mock.calls.at(-1)?.[2] as PlanDocument;
    expect(written.deadlines).toEqual({
      "projects/lex": { date: "2026-10-01" },
      "projects/ea48": { date: "2026-09-25", capacity: 3 }
    });
  });
});

describe("the way back from a reminder", () => {
  it("opens the note on the task's line", async () => {
    stored();
    client.saveEvent.mockResolvedValue("uid-1");
    const app = fakeApp({ "Other.md": "nothing", "Plan.md": NOTE });
    const subject = planner(app);
    await subject.refresh();
    const task = subject.current().tasks[1]!;
    await subject.planBlock({
      tag: "projects/ea48",
      title: "EA48",
      start: new Date("2026-09-20T05:30:00Z"),
      end: new Date("2026-09-20T06:00:00Z"),
      calendar: "Berufliches",
      tasks: [task],
      remind: [task]
    });
    const key = (client.savePlan.mock.calls.at(-1)?.[2] as PlanDocument).blocks[0]!.members[0]!.key;

    await subject.openKey(key);

    expect(app.fake.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Plan.md" }), {
      eState: { line: 1 }
    });
  });

  it("says so when no note holds the task any more", async () => {
    stored();
    const subject = planner(fakeApp());
    await subject.refresh();

    await subject.openKey("k-unknown");

    expect(Notice.shown.at(-1)).toContain("no note");
  });
});

describe("the marker a block carries in its calendar event", () => {
  it("is written and read back", () => {
    expect(blockTag(blockNotes("projects/ea48"))).toBe("projects/ea48");
    expect(blockTag("an ordinary meeting")).toBeNull();
  });
});
