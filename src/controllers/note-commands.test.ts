import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { MarkdownView, Notice, Platform, TFile, TFolder } from "../testing/obsidian-stub";
import { NoteCommands } from "./note-commands";
import { createLogger } from "../services/logger";
import { setLanguage, t } from "../i18n";

interface Fake {
  create: ReturnType<typeof vi.fn>;
  getNewFileParent: ReturnType<typeof vi.fn>;
  getLeaf: ReturnType<typeof vi.fn>;
  openPopoutLeaf: ReturnType<typeof vi.fn>;
  openFile: ReturnType<typeof vi.fn>;
  setActiveLeaf: ReturnType<typeof vi.fn>;
  windowFocus: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  collapseLeft: ReturnType<typeof vi.fn>;
  collapseRight: ReturnType<typeof vi.fn>;
  paths: Set<string>;
  leaf: unknown;
}

interface FakeOptions {
  paths?: string[];
  folder?: string;
  active?: string | null;
  view?: unknown;
  createFails?: boolean;
}

/**
 * A vault of paths, a folder preference, and one leaf that records what
 * happens to it — handed out both as a tab and as a pop-out, so a test can
 * check which door the command took.
 */
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
    setActiveLeaf: vi.fn(),
    windowFocus: vi.fn(),
    focus: vi.fn(),
    collapseLeft: vi.fn(),
    collapseRight: vi.fn(),
    getLeaf: vi.fn(),
    openPopoutLeaf: vi.fn(),
    leaf: null
  };
  const tabLeaf = {
    openFile: fake.openFile,
    view: view ?? Object.assign(new MarkdownView(), { editor: { focus: fake.focus } }),
    getContainer: () => ({})
  };
  const popoutLeaf = { ...tabLeaf, getContainer: () => ({ win: { focus: fake.windowFocus } }) };
  fake.getLeaf.mockReturnValue(tabLeaf);
  fake.openPopoutLeaf.mockReturnValue(popoutLeaf);

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
      openPopoutLeaf: fake.openPopoutLeaf,
      setActiveLeaf: fake.setActiveLeaf,
      leftSplit: { collapse: fake.collapseLeft },
      rightSplit: { collapse: fake.collapseRight }
    }
  } as unknown as App & { fake: Fake };
}

const logger = createLogger(() => false);

describe("a blank note in a window of its own", () => {
  beforeEach(() => {
    Notice.shown = [];
    Platform.isDesktopApp = true;
  });

  afterEach(() => {
    setLanguage("en");
    Platform.isDesktopApp = false;
  });

  it("creates Untitled where Obsidian says and opens it in a new window that takes focus", async () => {
    const app = fakeApp({ active: "Notes/a.md" });

    await new NoteCommands(app, logger).createUntitled();

    expect(app.fake.getNewFileParent).toHaveBeenCalledWith("Notes/a.md", "Untitled.md");
    expect(app.fake.create).toHaveBeenCalledWith("Untitled.md", "");
    expect(app.fake.openPopoutLeaf).toHaveBeenCalledTimes(1);
    expect(app.fake.getLeaf).not.toHaveBeenCalled();
    const opened = app.fake.openFile.mock.calls[0]?.[0] as TFile;
    expect(opened.path).toBe("Untitled.md");
    expect(app.fake.windowFocus).toHaveBeenCalledTimes(1);
    expect(app.fake.setActiveLeaf).toHaveBeenCalledWith(
      app.fake.openPopoutLeaf.mock.results[0]?.value,
      { focus: true }
    );
    expect(app.fake.focus).toHaveBeenCalledTimes(1);
    expect(app.fake.collapseLeft).not.toHaveBeenCalled();
    expect(app.fake.collapseRight).not.toHaveBeenCalled();
  });

  it("opens a tab and closes both drawers where there are no windows", async () => {
    Platform.isDesktopApp = false;
    const app = fakeApp();

    await new NoteCommands(app, logger).createUntitled();

    expect(app.fake.openPopoutLeaf).not.toHaveBeenCalled();
    expect(app.fake.getLeaf).toHaveBeenCalledWith("tab");
    expect(app.fake.openFile).toHaveBeenCalledTimes(1);
    expect(app.fake.collapseLeft).toHaveBeenCalledTimes(1);
    expect(app.fake.collapseRight).toHaveBeenCalledTimes(1);
    expect(app.fake.windowFocus).not.toHaveBeenCalled();
    expect(app.fake.setActiveLeaf).toHaveBeenCalledTimes(1);
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
    expect(app.fake.openPopoutLeaf).not.toHaveBeenCalled();
    expect(app.fake.openFile).not.toHaveBeenCalled();
    expect(app.fake.setActiveLeaf).not.toHaveBeenCalled();
  });

  it("still opens and focuses the window when the leaf holds no Markdown view", async () => {
    const app = fakeApp({ view: {} });

    await new NoteCommands(app, logger).createUntitled();

    expect(app.fake.openFile).toHaveBeenCalledTimes(1);
    expect(app.fake.windowFocus).toHaveBeenCalledTimes(1);
    expect(app.fake.focus).not.toHaveBeenCalled();
  });
});
