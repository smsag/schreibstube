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

function fakeApp(blocksByPath: Record<string, string[]> = {}): App {
  const files = Object.keys(blocksByPath).map((path) => new TFile(path));
  return {
    vault: { getMarkdownFiles: () => files },
    metadataCache: {
      getFileCache: (file: TFile) => ({
        blocks: Object.fromEntries((blocksByPath[file.path] ?? []).map((id) => [id, {}]))
      })
    },
    workspace: { openLinkText: vi.fn(async () => undefined) }
  } as unknown as App;
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

describe("sending a task", () => {
  let opened: string[];
  const logger = createLogger(() => false);

  beforeEach(() => {
    opened = [];
  });

  it("puts a block id on the task and opens the Shortcut with the task as JSON", () => {
    const lines = [
      "# Backlog",
      "- [ ] Call the bank #money",
      "    Ask about the fee",
      "- [ ] next"
    ];
    const editor = fakeEditor(lines);
    const commands = new ReminderCommands(fakeApp(), settings, logger, (url) => opened.push(url));

    commands.sendTask(editor, 1, note("Notes/Klartext Backlog.md"));

    expect(lines[1]).toMatch(/^- \[ \] Call the bank #money \^[a-z0-9]{6}$/);
    const id = lines[1]!.slice(-6);
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

  it("keeps a block id the task already has", () => {
    const lines = ["- [ ] task ^ab12cd"];
    const commands = new ReminderCommands(fakeApp(), settings, logger, (url) => opened.push(url));

    commands.sendTask(fakeEditor(lines), 0, note("n.md"));

    expect(lines[0]).toBe("- [ ] task ^ab12cd");
    expect(payloadOf(opened[0]!).link).toBe("obsidian://schreibstube?task=ab12cd");
  });

  it("does not draw an id the note already uses", () => {
    const lines = ["- [ ] task"];
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValue(0.5);
    const app = fakeApp({ "n.md": ["aaaaaa"] });
    const commands = new ReminderCommands(app, settings, logger, (url) => opened.push(url));

    commands.sendTask(fakeEditor(lines), 0, note("n.md"));

    expect(lines[0]).not.toContain("^aaaaaa");
    expect(lines[0]).toMatch(/\^[a-z0-9]{6}$/);
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
  const logger = createLogger(() => false);

  it("opens the note that holds the block, at the block", async () => {
    const app = fakeApp({ "a.md": ["one"], "b/c.md": ["ab12cd"] });
    const commands = new ReminderCommands(app, settings, logger, () => undefined);

    await commands.openTask({ task: "ab12cd" });

    expect(app.workspace.openLinkText).toHaveBeenCalledWith("b/c.md#^ab12cd", "", false);
  });

  it("opens nothing for an unknown or malformed id", async () => {
    const app = fakeApp({ "a.md": ["one"] });
    const commands = new ReminderCommands(app, settings, logger, () => undefined);

    await commands.openTask({ task: "zzzzzz" });
    await commands.openTask({ task: "../etc" });
    await commands.openTask({});

    expect(app.workspace.openLinkText).not.toHaveBeenCalled();
  });
});
