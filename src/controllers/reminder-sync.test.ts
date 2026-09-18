import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Editor } from "obsidian";
import { Notice, TFile } from "../testing/obsidian-stub";
import { INBOX_FILE, OUTBOX_FILE, ReminderSync, STATE_FILE } from "./reminder-sync";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { createLogger } from "../services/logger";
import { taskLink } from "../services/reminder-tasks";
import type { Outbox } from "../services/reminder-sync";
import type { SchreibstubeSettings } from "../types";

const FOLDER = ".schreibstube/reminders";

interface Fake {
  notes: Record<string, string>;
  files: Record<string, { text: string; mtime: number }>;
  openFile: ReturnType<typeof vi.fn>;
  writes: string[];
}

/** A vault of notes, plus the loose files the adapter serves. */
function fakeApp(notes: Record<string, string>): App & { fake: Fake } {
  const tfiles = new Map(Object.keys(notes).map((path) => [path, new TFile(path)]));
  const fake: Fake = { notes, files: {}, openFile: vi.fn(async () => undefined), writes: [] };
  let clock = 1;
  return {
    fake,
    vault: {
      getMarkdownFiles: () => [...tfiles.values()],
      getAbstractFileByPath: (path: string) => tfiles.get(path) ?? null,
      cachedRead: async (file: TFile) => notes[file.path] ?? "",
      process: async (file: TFile, fn: (data: string) => string) => {
        notes[file.path] = fn(notes[file.path] ?? "");
        return notes[file.path];
      },
      adapter: {
        exists: async (path: string) =>
          path in fake.files || Object.keys(fake.files).some((f) => f.startsWith(`${path}/`)),
        stat: async (path: string) =>
          path in fake.files ? { mtime: fake.files[path]!.mtime } : null,
        read: async (path: string) => fake.files[path]?.text ?? "",
        write: async (path: string, text: string) => {
          fake.writes.push(path);
          fake.files[path] = { text, mtime: (clock += 1) };
        },
        mkdir: async () => undefined
      }
    },
    workspace: { getLeaf: () => ({ openFile: fake.openFile }) }
  } as unknown as App & { fake: Fake };
}

function settings(overrides: Partial<SchreibstubeSettings> = {}): SchreibstubeSettings {
  return { ...DEFAULT_SETTINGS, remindersEnabled: true, remindersList: "Arbeit", ...overrides };
}

const logger = createLogger(() => false);

function outboxOf(app: App & { fake: Fake }): Outbox {
  return JSON.parse(app.fake.files[`${FOLDER}/${OUTBOX_FILE}`]?.text ?? "{}") as Outbox;
}

/** What the Shortcut would write after applying the outbox. */
function writeInbox(
  app: App & { fake: Fake },
  at: string,
  reminders: { id: string; done: boolean }[]
): void {
  const outbox = outboxOf(app);
  app.fake.files[`${FOLDER}/${INBOX_FILE}`] = {
    text: JSON.stringify({
      appliedSeq: outbox.seq,
      at,
      reminders: reminders.map((r) => ({ notes: `x\n${taskLink(r.id)}`, done: r.done }))
    }),
    mtime: Date.parse(at)
  };
}

describe("a sync pass", () => {
  beforeEach(() => {
    Notice.shown = [];
  });

  it("gives new reminder tasks an id and puts them in the outbox", async () => {
    const app = fakeApp({
      "Plan.md": "- [ ] Call the bank 📅 2026-09-20\n- [ ] plain\n",
      "Other.md": "no tasks"
    });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const sync = new ReminderSync(app, () => settings(), logger);

    expect(await sync.sync()).toBe(0);
    random.mockRestore();

    expect(app.fake.notes["Plan.md"]).toBe(
      "- [ ] Call the bank 📅 2026-09-20 ^r-aaaaaa\n- [ ] plain\n"
    );
    const outbox = outboxOf(app);
    expect(outbox).toMatchObject({ v: 1, seq: 1, list: "Arbeit" });
    expect(outbox.ops).toEqual([
      {
        op: "upsert",
        id: "r-aaaaaa",
        match: "task=r-aaaaaa&",
        title: "Call the bank",
        notes: `↩ Plan\n${taskLink("r-aaaaaa")}`,
        due: "2026-09-20"
      }
    ]);
    expect(app.fake.files[`${FOLDER}/${STATE_FILE}`]).toBeDefined();
  });

  it("ticks a task whose reminder was completed, and empties the outbox", async () => {
    const app = fakeApp({ "Plan.md": "- [ ] Call #remind ^r-one\n- [ ] Other #remind ^r-two" });
    const sync = new ReminderSync(app, () => settings(), logger);
    await sync.sync();

    writeInbox(app, "2026-09-18T10:00:00Z", [
      { id: "r-one", done: true },
      { id: "r-two", done: false }
    ]);
    expect(await sync.sync()).toBe(1);

    expect(app.fake.notes["Plan.md"]).toBe("- [x] Call #remind ^r-one\n- [ ] Other #remind ^r-two");
    expect(outboxOf(app).ops).toEqual([]);
    expect(Notice.shown.some((message) => message.includes("1"))).toBe(true);
  });

  it("writes nothing when nothing changed", async () => {
    const app = fakeApp({ "Plan.md": "- [ ] Call #remind ^r-one" });
    const sync = new ReminderSync(app, () => settings(), logger);
    await sync.sync();
    const writes = app.fake.writes.length;

    await sync.sync();

    expect(app.fake.writes.length).toBe(writes);
  });

  it("reads a new inbox on the poll, and only a new one", async () => {
    const app = fakeApp({ "Plan.md": "- [ ] Call #remind ^r-one" });
    const sync = new ReminderSync(app, () => settings(), logger);
    await sync.sync();
    writeInbox(app, "2026-09-18T10:00:00Z", [{ id: "r-one", done: true }]);

    await sync.pollInbox();
    expect(app.fake.notes["Plan.md"]).toBe("- [x] Call #remind ^r-one");

    app.fake.notes["Plan.md"] = "- [ ] Call #remind ^r-one";
    await sync.pollInbox();
    expect(app.fake.notes["Plan.md"]).toBe("- [ ] Call #remind ^r-one");
  });

  it("does nothing while the feature is off", async () => {
    const app = fakeApp({ "Plan.md": "- [ ] Call #remind" });
    const sync = new ReminderSync(app, () => settings({ remindersEnabled: false }), logger);
    await sync.sync();
    await sync.pollInbox();
    expect(app.fake.notes["Plan.md"]).toBe("- [ ] Call #remind");
    expect(app.fake.writes).toEqual([]);
  });

  it("syncs only one of two tasks that share an id", async () => {
    const app = fakeApp({ "A.md": "- [ ] a #remind ^same", "B.md": "- [ ] b #remind ^same" });
    const sync = new ReminderSync(app, () => settings(), logger);
    await sync.sync();
    expect(outboxOf(app).ops.map((op) => op.id)).toEqual(["same"]);
  });

  it("reports a failed pass instead of throwing", async () => {
    const app = fakeApp({ "Plan.md": "- [ ] Call #remind ^r-one" });
    (app.vault.adapter as unknown as { write: () => Promise<void> }).write = async () => {
      throw new Error("disk full");
    };
    const sync = new ReminderSync(app, () => settings(), logger);
    await sync.syncNow();
    expect(Notice.shown.at(-1)).toContain("failed");
  });
});

describe("making a task a reminder", () => {
  function fakeEditor(lines: string[]): Editor {
    return {
      getLine: (n: number) => lines[n] ?? "",
      setLine: (n: number, text: string) => {
        lines[n] = text;
      },
      getCursor: () => ({ line: 0, ch: 0 })
    } as unknown as Editor;
  }

  beforeEach(() => {
    Notice.shown = [];
    vi.stubGlobal("window", { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tags the task and asks for a sync", () => {
    const lines = ["- [ ] Call the bank"];
    const sync = new ReminderSync(fakeApp({}), () => settings(), logger);
    sync.sendTask(fakeEditor(lines), 0);
    expect(lines[0]).toBe("- [ ] Call the bank #remind");
    expect(window.setTimeout).toHaveBeenCalled();
  });

  it("leaves a task that is already a reminder as it is", () => {
    const lines = ["- [ ] Call 📅 2026-09-20 ^r-one"];
    const sync = new ReminderSync(fakeApp({}), () => settings(), logger);
    sync.sendTask(fakeEditor(lines), 0);
    expect(lines[0]).toBe("- [ ] Call 📅 2026-09-20 ^r-one");
  });

  it("refuses a line that is not a task, and says so while the feature is off", () => {
    const lines = ["plain"];
    new ReminderSync(fakeApp({}), () => settings(), logger).sendTask(fakeEditor(lines), 0);
    new ReminderSync(fakeApp({}), () => settings({ remindersEnabled: false }), logger).sendTask(
      fakeEditor(lines),
      0
    );
    expect(lines[0]).toBe("plain");
    expect(Notice.shown).toHaveLength(2);
  });
});

describe("the way back", () => {
  it("opens the note on the task's line", async () => {
    const app = fakeApp({ "A.md": "x", "B.md": "intro\n- [ ] Call #remind ^r-one" });
    const sync = new ReminderSync(app, () => settings(), logger);

    await sync.handleProtocol({ task: "r-one", from: "reminders" });

    expect(app.fake.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "B.md" }), {
      eState: { line: 1 }
    });
  });

  it("says so when no note holds the task, and ignores calls that are not a task", async () => {
    Notice.shown = [];
    const app = fakeApp({ "A.md": "x" });
    const sync = new ReminderSync(app, () => settings(), logger);
    await sync.handleProtocol({ task: "r-gone" });
    await sync.handleProtocol({ done: "1" });
    expect(app.fake.openFile).not.toHaveBeenCalled();
    expect(Notice.shown).toHaveLength(1);
  });
});
