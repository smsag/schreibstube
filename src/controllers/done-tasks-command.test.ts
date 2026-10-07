import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Editor, TFile as ObsidianFile } from "obsidian";
import { MarkdownView, Notice, TFile } from "../testing/obsidian-stub";
import { createLogger } from "../services/logger";
import type { DoneTaskMode } from "../services/done-tasks";
import { setLanguage, t } from "../i18n";
import { DoneTasksCommand } from "./done-tasks-command";

/** An editor over a string, with the offset arithmetic Obsidian's has. */
class FakeEditor {
  replacements = 0;
  constructor(public text: string) {}

  getValue(): string {
    return this.text;
  }

  offsetToPos(offset: number): { line: number; ch: number } {
    const before = this.text.slice(0, offset).split("\n");
    return { line: before.length - 1, ch: before[before.length - 1]?.length ?? 0 };
  }

  replaceRange(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) {
    this.replacements += 1;
    this.text = this.text.slice(0, this.offset(from)) + text + this.text.slice(this.offset(to));
  }

  private offset(pos: { line: number; ch: number }): number {
    const lines = this.text.split("\n").slice(0, pos.line);
    return lines.reduce((sum, line) => sum + line.length + 1, 0) + pos.ch;
  }
}

function viewOf(file: TFile, editor: FakeEditor): MarkdownView {
  return Object.assign(new MarkdownView(), { file, editor });
}

interface Setup {
  mode?: DoneTaskMode;
  /** The views the workspace holds when the undo is pressed. */
  views?: MarkdownView[];
  disk?: string;
  processFails?: boolean;
}

function setup({ mode = "back", views = [], disk = "", processFails = false }: Setup = {}) {
  const state = { disk, views };
  const app = {
    workspace: { getLeavesOfType: () => state.views.map((view) => ({ view })) },
    vault: {
      process: vi.fn(async (_file: ObsidianFile, apply: (text: string) => string) => {
        if (processFails) throw new Error("locked");
        state.disk = apply(state.disk);
        return state.disk;
      })
    }
  } as unknown as App;
  const undo: (() => void)[] = [];
  const messages: string[] = [];
  const command = new DoneTasksCommand(
    app,
    () => mode,
    createLogger(() => false),
    (message, _label, onUndo) => {
      messages.push(message);
      undo.push(onUndo);
    }
  );
  return { command, state, app, undo, messages };
}

const NOTE = ["- [x] a", "  Note.", "- [ ] b", "", "Text"].join("\n");
const BACK = ["- [ ] b", "- [x] a", "  Note.", "", "Text"].join("\n");
const file = new TFile("Plan.md");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("DoneTasksCommand", () => {
  beforeEach(() => {
    setLanguage("en");
    Notice.shown = [];
  });

  it("changes the note in one replacement and offers the undo", () => {
    const editor = new FakeEditor(NOTE);
    const { command, messages } = setup();
    command.run(editor as unknown as Editor, file as unknown as ObsidianFile);
    expect(editor.text).toBe(BACK);
    expect(editor.replacements).toBe(1);
    expect(messages).toEqual([t().common.notice(t().tasks.moved(1))]);
  });

  it("names what it did in each mode", () => {
    for (const [mode, message] of [
      ["archive", t().tasks.archived(1)],
      ["delete", t().tasks.deleted(1)]
    ] as const) {
      const { command, messages } = setup({ mode });
      command.run(new FakeEditor(NOTE) as unknown as Editor, null);
      expect(messages).toEqual([t().common.notice(message)]);
    }
  });

  it("says so when there is nothing to do, and offers no undo", () => {
    const back = setup();
    back.command.run(new FakeEditor("- [ ] a") as unknown as Editor, null);
    const del = setup({ mode: "delete" });
    del.command.run(new FakeEditor("- [ ] a") as unknown as Editor, null);
    expect(back.messages).toEqual([]);
    expect(Notice.shown).toEqual([
      t().common.notice(t().tasks.nothingBack),
      t().common.notice(t().tasks.nothing)
    ]);
  });

  it("undoes in the editor that shows the note, keeping typing elsewhere", async () => {
    const ran = new FakeEditor(NOTE);
    const showing = new FakeEditor("");
    const { command, undo } = setup({
      views: [viewOf(new TFile("Other.md"), ran), viewOf(file, showing)]
    });
    command.run(ran as unknown as Editor, file as unknown as ObsidianFile);
    showing.text = ran.text.replace("Text", "Text, and more");
    undo[0]?.();
    await flush();
    expect(showing.text).toBe(NOTE.replace("Text", "Text, and more"));
    expect(Notice.shown.at(-1)).toBe(t().common.notice(t().tasks.undone));
  });

  it("undoes in the editor it ran in when the note has no file", async () => {
    const editor = new FakeEditor(NOTE);
    const { command, undo } = setup();
    command.run(editor as unknown as Editor, null);
    undo[0]?.();
    await flush();
    expect(editor.text).toBe(NOTE);
  });

  it("undoes through the vault when the note is no longer open", async () => {
    const editor = new FakeEditor(NOTE);
    const { command, undo, state } = setup({ mode: "delete" });
    command.run(editor as unknown as Editor, file as unknown as ObsidianFile);
    state.disk = editor.text;
    undo[0]?.();
    await flush();
    expect(state.disk).toBe(NOTE);
  });

  it("says the undo failed when the lines were edited, or the vault refused", async () => {
    const edited = setup();
    const editor = new FakeEditor(NOTE);
    edited.state.views = [viewOf(file, editor)];
    edited.command.run(editor as unknown as Editor, file as unknown as ObsidianFile);
    editor.text = editor.text.replace("- [ ] b", "- [ ] B");
    edited.undo[0]?.();
    await flush();
    expect(editor.text).toContain("- [ ] B");

    const refused = setup({ processFails: true });
    refused.command.run(new FakeEditor(NOTE) as unknown as Editor, file as unknown as ObsidianFile);
    refused.undo[0]?.();
    await flush();

    const failed = t().common.notice(t().tasks.undoFailed);
    expect(Notice.shown.filter((message) => message === failed)).toHaveLength(2);
  });
});
