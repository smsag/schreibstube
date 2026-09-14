import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Editor, TFile as ObsidianFile } from "obsidian";
import { TFile } from "../testing/obsidian-stub";
import { ReminderCommands } from "./reminder-commands";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { createLogger } from "../services/logger";
import type { SchreibstubeSettings } from "../types";

/** The stub file, typed as the real one so the controller's signature accepts it. */
function note(path: string): ObsidianFile {
  return new TFile(path) as unknown as ObsidianFile;
}

/** An editor that is a list of lines and a cursor, which is all the command reads. */
function fakeEditor(lines: string[], cursorLine = 0): Editor {
  return {
    getLine: (n: number) => lines[n] ?? "",
    setLine: (n: number, text: string) => {
      lines[n] = text;
    },
    getValue: () => lines.join("\n"),
    getCursor: () => ({ line: cursorLine, ch: 0 })
  } as unknown as Editor;
}

interface Fake {
  openFile: ReturnType<typeof vi.fn>;
  reads: string[];
  notes: Record<string, string>;
  files: Record<string, { text: string; mtime: number }>;
}

/** A vault of notes, plus loose files the adapter serves, for the report. */
function fakeApp(
  notes: Record<string, string> = {},
  files: Record<string, { text: string; mtime: number }> = {}
): App & { fake: Fake } {
  const tfiles = new Map(Object.keys(notes).map((path) => [path, new TFile(path)]));
  const fake: Fake = { openFile: vi.fn(async () => undefined), reads: [], notes, files };
  return {
    fake,
    vault: {
      getMarkdownFiles: () => [...tfiles.values()],
      getAbstractFileByPath: (path: string) => tfiles.get(path) ?? null,
      cachedRead: async (file: TFile) => {
        fake.reads.push(file.path);
        return notes[file.path] ?? "";
      },
      process: async (file: TFile, fn: (data: string) => string) => {
        notes[file.path] = fn(notes[file.path] ?? "");
        return notes[file.path];
      },
      adapter: {
        exists: async (path: string) => path in files,
        stat: async (path: string) => (path in files ? { mtime: files[path]!.mtime } : null),
        read: async (path: string) => files[path]?.text ?? ""
      }
    },
    workspace: { getLeaf: () => ({ openFile: fake.openFile }) }
  } as unknown as App & { fake: Fake };
}

function settings(overrides: Partial<SchreibstubeSettings> = {}): SchreibstubeSettings {
  return {
    ...DEFAULT_SETTINGS,
    remindersEnabled: true,
    remindersShortcut: "Schreibstube Reminder",
    remindersStatusShortcut: "Schreibstube Reminder Status",
    remindersList: "Arbeit",
    ...overrides
  };
}

function payloadOf(url: string): Record<string, unknown> {
  const params = new URL(url.replace(/^shortcuts:\/\//, "https://x/")).searchParams;
  return JSON.parse(params.get("text") ?? "{}") as Record<string, unknown>;
}

const link = (id: string) => `[⏰](obsidian://schreibstube?task=${id})`;
const LINK = link("ab12cd");
const logger = createLogger(() => false);

describe("sending a task", () => {
  let opened: string[];

  beforeEach(() => {
    opened = [];
  });

  it("puts the link on the task and opens the Shortcut with the task as JSON", () => {
    const lines = [
      "# Backlog",
      "- [ ] Call the bank #money",
      "    Ask about the fee",
      "- [ ] next"
    ];
    const editor = fakeEditor(lines);
    const commands = new ReminderCommands(fakeApp(), settings, logger, (url) => opened.push(url));

    commands.sendTask(editor, 1, note("Notes/Klartext Backlog.md"));

    expect(lines[1]).toMatch(
      /^- \[ \] Call the bank #money \[⏰\]\(obsidian:\/\/schreibstube\?task=[a-z0-9]{6}\)$/
    );
    const id = /task=([a-z0-9]{6})/.exec(lines[1]!)![1];
    expect(opened).toHaveLength(1);
    expect(opened[0]!.startsWith("shortcuts://run-shortcut?name=Schreibstube%20Reminder&")).toBe(
      true
    );
    expect(payloadOf(opened[0]!)).toEqual({
      title: "Call the bank #money",
      notes: `Ask about the fee\n\n↩ Klartext Backlog\nobsidian://schreibstube?task=${id}`,
      list: "Arbeit",
      link: `obsidian://schreibstube?task=${id}`,
      note: "Klartext Backlog"
    });
  });

  it("keeps the link a task already has", () => {
    const lines = [`- [ ] task ${LINK}`];
    const commands = new ReminderCommands(fakeApp(), settings, logger, (url) => opened.push(url));

    commands.sendTask(fakeEditor(lines), 0, note("n.md"));

    expect(lines[0]).toBe(`- [ ] task ${LINK}`);
    expect(payloadOf(opened[0]!).link).toBe("obsidian://schreibstube?task=ab12cd");
  });

  it("does not draw an id the note already uses", () => {
    const lines = ["- [ ] task", `- [x] other ${link("aaaaaa")}`];
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValue(0.5);
    const commands = new ReminderCommands(fakeApp(), settings, logger, (url) => opened.push(url));

    commands.sendTask(fakeEditor(lines), 0, note("n.md"));

    expect(lines[0]).not.toContain("task=aaaaaa");
    expect(lines[0]).toMatch(/task=[a-z0-9]{6}\)$/);
    random.mockRestore();
  });

  it("does nothing when the feature is off, the Shortcut is unnamed, or the line is no task", () => {
    const lines = ["- [ ] task", "plain"];
    const off = new ReminderCommands(
      fakeApp(),
      () => settings({ remindersEnabled: false }),
      logger,
      (url) => opened.push(url)
    );
    off.sendTask(fakeEditor(lines), 0, note("n.md"));

    const unnamed = new ReminderCommands(
      fakeApp(),
      () => settings({ remindersShortcut: "" }),
      logger,
      (url) => opened.push(url)
    );
    unnamed.sendTask(fakeEditor(lines), 0, note("n.md"));

    const commands = new ReminderCommands(fakeApp(), settings, logger, (url) => opened.push(url));
    commands.sendTask(fakeEditor(lines), 1, note("n.md"));

    expect(opened).toEqual([]);
    expect(lines).toEqual(["- [ ] task", "plain"]);
  });
});

describe("coming back from a reminder", () => {
  it("opens the note that carries the link, on the task's line", async () => {
    const app = fakeApp({
      "a.md": "- [ ] one",
      "b/c.md": `# H\n\n- [ ] two ${LINK}\n    body`
    });
    const commands = new ReminderCommands(app, settings, logger, () => undefined);

    await commands.handleProtocol({ task: "ab12cd" });

    expect(app.fake.openFile).toHaveBeenCalledTimes(1);
    const [file, state] = app.fake.openFile.mock.calls[0] as [TFile, { eState: { line: number } }];
    expect(file.path).toBe("b/c.md");
    expect(state).toEqual({ eState: { line: 2 } });
  });

  it("remembers where an id was and reads that note first next time", async () => {
    const app = fakeApp({ "a.md": "- [ ] one", "b.md": `- [ ] two ${LINK}` });
    const commands = new ReminderCommands(app, settings, logger, () => undefined);

    await commands.openTask({ task: "ab12cd" });
    app.fake.reads.length = 0;
    await commands.openTask({ task: "ab12cd" });

    expect(app.fake.reads).toEqual(["b.md"]);
  });

  it("opens nothing for an unknown or malformed id", async () => {
    const app = fakeApp({ "a.md": "- [ ] one" });
    const commands = new ReminderCommands(app, settings, logger, () => undefined);

    await commands.openTask({ task: "zzzzzz" });
    await commands.openTask({ task: "../etc" });
    await commands.openTask({});

    expect(app.fake.openFile).not.toHaveBeenCalled();
  });
});

describe("asking Reminders what is done", () => {
  let opened: string[];

  beforeEach(() => {
    opened = [];
  });

  it("asks about the sent tasks of a note, with a callback into the plugin", () => {
    const commands = new ReminderCommands(fakeApp(), settings, logger, (url) => opened.push(url));

    commands.checkNote(
      [`- [ ] a ${link("aaaaaa")}`, "- [ ] b", `- [x] c ${link("cccccc")}`].join("\n")
    );

    expect(opened).toHaveLength(1);
    const params = new URL(opened[0]!.replace(/^shortcuts:\/\//, "https://x/")).searchParams;
    expect(
      opened[0]!.startsWith(
        "shortcuts://x-callback-url/run-shortcut?name=Schreibstube%20Reminder%20Status&"
      )
    ).toBe(true);
    expect(payloadOf(opened[0]!)).toEqual({
      ids: ["aaaaaa", "cccccc"],
      links: ["obsidian://schreibstube?task=aaaaaa", "obsidian://schreibstube?task=cccccc"],
      list: "Arbeit"
    });
    expect(params.get("x-success")).toBe("obsidian://schreibstube?done=1");
  });

  it("asks nothing for a note with no sent task, and nothing without a status Shortcut", () => {
    const commands = new ReminderCommands(fakeApp(), settings, logger, (url) => opened.push(url));
    commands.checkNote("- [ ] a\n- [ ] b");

    const unnamed = new ReminderCommands(
      fakeApp(),
      () => settings({ remindersStatusShortcut: "" }),
      logger,
      (url) => opened.push(url)
    );
    unnamed.checkNote(`- [ ] a ${link("aaaaaa")}`);

    expect(opened).toEqual([]);
  });

  it("asks about everything when no ids are given", () => {
    const commands = new ReminderCommands(fakeApp(), settings, logger, (url) => opened.push(url));
    commands.checkEverything();
    expect(payloadOf(opened[0]!)).toEqual({ ids: [], links: [], list: "Arbeit" });
  });
});

describe("a report of done reminders", () => {
  const report = [
    "Ask about the fee",
    "↩ Backlog",
    "obsidian://schreibstube?task=aaaaaa",
    "↩ Other",
    "obsidian://schreibstube?task=cccccc"
  ].join("\n");

  it("ticks the named tasks wherever they are, and only the open ones", async () => {
    const app = fakeApp({
      "a.md": `- [ ] one ${link("aaaaaa")}\n- [ ] two ${link("bbbbbb")}`,
      "b.md": `- [x] three ${link("cccccc")}\n- [ ] plain`
    });
    const commands = new ReminderCommands(app, settings, logger, () => undefined);

    await commands.handleProtocol({ done: "1", result: report });

    expect(app.fake.notes["a.md"]).toBe(`- [x] one ${link("aaaaaa")}\n- [ ] two ${link("bbbbbb")}`);
    expect(app.fake.notes["b.md"]).toBe(`- [x] three ${link("cccccc")}\n- [ ] plain`);
  });

  it("reads the report file an automation wrote, once per change", async () => {
    const app = fakeApp(
      { "a.md": `- [ ] one ${link("aaaaaa")}\n- [ ] three ${link("cccccc")}` },
      { "schreibstube-reminders.txt": { text: "obsidian://schreibstube?task=aaaaaa", mtime: 10 } }
    );
    const commands = new ReminderCommands(app, settings, logger, () => undefined);

    await commands.pollReportFile();
    expect(app.fake.notes["a.md"]).toBe(
      `- [x] one ${link("aaaaaa")}\n- [ ] three ${link("cccccc")}`
    );

    // Same file, same time: not read again. Newer file: applied.
    app.fake.reads.length = 0;
    await commands.pollReportFile();
    expect(app.fake.reads).toEqual([]);

    app.fake.files["schreibstube-reminders.txt"] = { text: report, mtime: 20 };
    await commands.pollReportFile();
    expect(app.fake.notes["a.md"]).toBe(
      `- [x] one ${link("aaaaaa")}\n- [x] three ${link("cccccc")}`
    );
  });

  it("leaves the vault alone when the file is missing, the feature is off, or the path is empty", async () => {
    const notes = { "a.md": `- [ ] one ${link("aaaaaa")}` };
    const missing = new ReminderCommands(fakeApp(notes), settings, logger, () => undefined);
    await missing.pollReportFile();

    const files = { "schreibstube-reminders.txt": { text: report, mtime: 10 } };
    const off = new ReminderCommands(
      fakeApp(notes, files),
      () => settings({ remindersEnabled: false }),
      logger,
      () => undefined
    );
    await off.pollReportFile();

    const unset = new ReminderCommands(
      fakeApp(notes, files),
      () => settings({ remindersReportFile: "" }),
      logger,
      () => undefined
    );
    await unset.pollReportFile();

    expect(notes["a.md"]).toBe(`- [ ] one ${link("aaaaaa")}`);
  });
});
