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

interface FakeWorkspace {
  openFile: ReturnType<typeof vi.fn>;
  reads: string[];
}

function fakeApp(notes: Record<string, string> = {}): App & { fake: FakeWorkspace } {
  const files = new Map(Object.keys(notes).map((path) => [path, new TFile(path)]));
  const fake: FakeWorkspace = { openFile: vi.fn(async () => undefined), reads: [] };
  return {
    fake,
    vault: {
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: async (file: TFile) => {
        fake.reads.push(file.path);
        return notes[file.path] ?? "";
      }
    },
    workspace: { getLeaf: () => ({ openFile: fake.openFile }) }
  } as unknown as App & { fake: FakeWorkspace };
}

function settings(overrides: Partial<SchreibstubeSettings> = {}): SchreibstubeSettings {
  return {
    ...DEFAULT_SETTINGS,
    remindersEnabled: true,
    remindersShortcut: "Schreibstube Reminder",
    remindersList: "Arbeit",
    ...overrides
  };
}

function payloadOf(url: string): Record<string, string> {
  return JSON.parse(decodeURIComponent(url.slice(url.indexOf("&text=") + 6))) as Record<
    string,
    string
  >;
}

const LINK = "[⏰](obsidian://schreibstube?task=ab12cd)";
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
    const lines = ["- [ ] task", "- [x] other [⏰](obsidian://schreibstube?task=aaaaaa)"];
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

    await commands.openTask({ task: "ab12cd" });

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
