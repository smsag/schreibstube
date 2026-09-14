import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { MarkdownView, Notice, TFile, TFolder } from "../testing/obsidian-stub";
import { NoteCommands } from "./note-commands";
import { createLogger } from "../services/logger";
import { setLanguage, t } from "../i18n";

interface Fake {
  create: ReturnType<typeof vi.fn>;
  getNewFileParent: ReturnType<typeof vi.fn>;
  getLeaf: ReturnType<typeof vi.fn>;
  openFile: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  collapseLeft: ReturnType<typeof vi.fn>;
  collapseRight: ReturnType<typeof vi.fn>;
  paths: Set<string>;
}

interface FakeOptions {
  paths?: string[];
  folder?: string;
  active?: string | null;
  view?: unknown;
  createFails?: boolean;
}

/** A vault of paths, a folder preference, and a leaf that records what happens to it. */
function fakeApp({
  paths = [],
  folder = "/",
  active = null,
  view,
  createFails = false
}: FakeOptions = {}): App & { fake: Fake } {
  const fake: Fake = {
    paths: new Set(paths),
    create: vi.fn(async (path: string) => {
      if (createFails) throw new Error("exists");
      fake.paths.add(path);
      return new TFile(path);
    }),
    getNewFileParent: vi.fn(() => new TFolder(folder)),
    openFile: vi.fn(async () => undefined),
    focus: vi.fn(),
    collapseLeft: vi.fn(),
    collapseRight: vi.fn(),
    getLeaf: vi.fn()
  };
  const leaf = {
    openFile: fake.openFile,
    view: view ?? Object.assign(new MarkdownView(), { editor: { focus: fake.focus } })
  };
  fake.getLeaf.mockReturnValue(leaf);

  return {
    fake,
    vault: {
      getAbstractFileByPath: (path: string) => (fake.paths.has(path) ? new TFile(path) : null),
      create: fake.create
    },
    fileManager: { getNewFileParent: fake.getNewFileParent },
    workspace: {
      getActiveFile: () => (active ? new TFile(active) : null),
      getLeaf: fake.getLeaf,
      leftSplit: { collapse: fake.collapseLeft },
      rightSplit: { collapse: fake.collapseRight }
    }
  } as unknown as App & { fake: Fake };
}

const logger = createLogger(() => false);

describe("a blank note with nothing else on screen", () => {
  beforeEach(() => {
    Notice.shown = [];
  });

  afterEach(() => {
    setLanguage("en");
  });

  it("creates Untitled where Obsidian says, opens it in a new tab, and closes both sidebars", async () => {
    const app = fakeApp({ active: "Notes/a.md" });

    await new NoteCommands(app, logger).createUntitled();

    expect(app.fake.getNewFileParent).toHaveBeenCalledWith("Notes/a.md", "Untitled.md");
    expect(app.fake.create).toHaveBeenCalledWith("Untitled.md", "");
    expect(app.fake.getLeaf).toHaveBeenCalledWith("tab");
    const opened = app.fake.openFile.mock.calls[0]?.[0] as TFile;
    expect(opened.path).toBe("Untitled.md");
    expect(app.fake.collapseLeft).toHaveBeenCalledTimes(1);
    expect(app.fake.collapseRight).toHaveBeenCalledTimes(1);
    expect(app.fake.focus).toHaveBeenCalledTimes(1);
  });

  it("counts past the untitled notes already in the folder", async () => {
    const app = fakeApp({
      folder: "Notes",
      paths: ["Notes/Untitled.md", "Notes/Untitled 1.md", "Untitled 2.md"]
    });

    await new NoteCommands(app, logger).createUntitled();

    expect(app.fake.create).toHaveBeenCalledWith("Notes/Untitled 2.md", "");
  });

  it("asks for the folder with no source path when nothing is open", async () => {
    const app = fakeApp();
    await new NoteCommands(app, logger).createUntitled();
    expect(app.fake.getNewFileParent).toHaveBeenCalledWith("", "Untitled.md");
  });

  it("names the note in the interface language", async () => {
    setLanguage("de");
    const app = fakeApp({ paths: ["Unbenannt.md"] });

    await new NoteCommands(app, logger).createUntitled();

    expect(app.fake.create).toHaveBeenCalledWith("Unbenannt 1.md", "");
  });

  it("says so and stops when the vault refuses to create the note", async () => {
    const app = fakeApp({ createFails: true });

    await new NoteCommands(app, logger).createUntitled();

    expect(Notice.shown).toEqual([t().common.notice(t().notes.createFailed)]);
    expect(app.fake.openFile).not.toHaveBeenCalled();
    expect(app.fake.collapseLeft).not.toHaveBeenCalled();
    expect(app.fake.collapseRight).not.toHaveBeenCalled();
  });

  it("still opens and clears the screen when the leaf holds no Markdown view", async () => {
    const app = fakeApp({ view: {} });

    await new NoteCommands(app, logger).createUntitled();

    expect(app.fake.openFile).toHaveBeenCalledTimes(1);
    expect(app.fake.collapseLeft).toHaveBeenCalledTimes(1);
    expect(app.fake.collapseRight).toHaveBeenCalledTimes(1);
    expect(app.fake.focus).not.toHaveBeenCalled();
  });
});
