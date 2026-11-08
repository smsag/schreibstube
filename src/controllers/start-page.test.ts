// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile, TFolder } from "../testing/obsidian-stub";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { HOME_LANGUAGE } from "../services/home-block";
import { START_PAGE_SETTLE_MS } from "../services/start-page";
import type { SchreibstubeSettings } from "../types";
import { StartPageController } from "./start-page";

const SILENT = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

interface FakeLeaf {
  type: string;
  isDeferred: boolean;
  root: unknown;
  getViewState(): { type: string };
  getRoot(): unknown;
  openFile: ReturnType<typeof vi.fn>;
}

/**
 * A workspace of one main area and two sidebars, a current tab, and a vault
 * holding the files given. Events are kept so a test can fire them.
 */
function setup(options: { files?: string[]; startPage?: string; fail?: boolean } = {}) {
  const rootSplit = { name: "root" };
  const leftSplit = { name: "left" };
  const rightSplit = { name: "right" };
  const files = new Map<string, TFile | TFolder>(
    (options.files ?? ["Start.md"]).map((path) => [path, new TFile(path)])
  );
  const handlers = new Map<string, Array<() => void>>();
  const leaf = (type: string, root: unknown = rootSplit): FakeLeaf => {
    const made: FakeLeaf = {
      type,
      isDeferred: false,
      root,
      getViewState: () => ({ type: made.type }),
      getRoot: () => made.root,
      openFile: vi.fn(async (file: TFile) => {
        if (options.fail) throw new Error("no");
        made.type = file.extension === "md" ? "markdown" : file.extension;
      })
    };
    return made;
  };
  let current: FakeLeaf | null = leaf("empty");
  const created: Array<{ path: string; text: string }> = [];
  const folders: string[] = [];

  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      create: vi.fn(async (path: string, text: string) => {
        created.push({ path, text });
        const file = new TFile(path);
        files.set(path, file);
        return file;
      }),
      createFolder: vi.fn(async (path: string) => {
        folders.push(path);
        files.set(path, new TFolder(path));
      })
    },
    workspace: {
      rootSplit,
      leftSplit,
      rightSplit,
      on: (name: string, handler: () => void) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
        return { name };
      },
      onLayoutReady: (run: () => void) => run(),
      getMostRecentLeaf: () => current,
      getLeaf: () => current
    }
  };

  const settings: SchreibstubeSettings = {
    ...DEFAULT_SETTINGS,
    startPageFile: options.startPage ?? "Start.md"
  };
  const controller = new StartPageController(app as unknown as App, () => settings, SILENT);
  const cleanups: Array<() => void> = [];
  controller.start({ registerEvent: () => {}, register: (cleanup) => cleanups.push(cleanup) });

  return {
    controller,
    settings,
    leftSplit,
    created,
    folders,
    leaf,
    current: () => current,
    show: (next: FakeLeaf | null) => {
      current = next;
    },
    fire: (name: string) => {
      for (const handler of handlers.get(name) ?? []) handler();
    },
    settle: async () => {
      await vi.advanceTimersByTimeAsync(START_PAGE_SETTLE_MS);
    },
    unload: () => cleanups.forEach((cleanup) => cleanup())
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  Notice.shown = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StartPageController", () => {
  it("opens the start page in the empty tab at launch, in Reading view", async () => {
    const page = setup();
    await page.settle();
    const opened = page.current()?.openFile;
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened?.mock.calls[0]?.[0]).toMatchObject({ path: "Start.md" });
    expect(opened?.mock.calls[0]?.[1]).toEqual({ state: { mode: "preview" } });
  });

  it("opens a base as a base, without a mode", async () => {
    const page = setup({ files: ["Recent.base"], startPage: "Recent.base" });
    await page.settle();
    expect(page.current()?.openFile.mock.calls[0]).toHaveLength(1);
  });

  it("turns a new empty tab into the start page once its events settle", async () => {
    const page = setup();
    await page.settle();

    const fresh = page.leaf("empty");
    page.show(fresh);
    page.fire("layout-change");
    await vi.advanceTimersByTimeAsync(START_PAGE_SETTLE_MS - 1);
    // Another event in the burst starts the wait again.
    page.fire("active-leaf-change");
    await vi.advanceTimersByTimeAsync(START_PAGE_SETTLE_MS - 1);
    expect(fresh.openFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fresh.openFile).toHaveBeenCalledTimes(1);
  });

  it("leaves a tab whose note loaded meanwhile", async () => {
    const page = setup();
    await page.settle();
    const linked = page.leaf("empty");
    page.show(linked);
    page.fire("active-leaf-change");
    linked.type = "markdown";
    await page.settle();
    expect(linked.openFile).not.toHaveBeenCalled();
  });

  it("leaves sidebars, restored tabs and tabs that show something", async () => {
    const page = setup();
    await page.settle();

    const side = page.leaf("empty", page.leftSplit);
    const restored = page.leaf("empty");
    restored.isDeferred = true;
    const note = page.leaf("markdown");
    for (const leaf of [restored, note]) {
      page.show(leaf);
      page.fire("layout-change");
      await page.settle();
      expect(leaf.openFile).not.toHaveBeenCalled();
    }

    // getMostRecentLeaf is asked for the main area; a sidebar tab handed back
    // anyway is still not taken.
    page.show(side);
    page.fire("layout-change");
    await page.settle();
    expect(side.openFile).not.toHaveBeenCalled();
  });

  it("does nothing while the start page is off or its file is gone", async () => {
    const off = setup({ startPage: "" });
    await off.settle();
    expect(off.current()?.openFile).not.toHaveBeenCalled();

    const gone = setup({ files: [] });
    await gone.settle();
    expect(gone.current()?.openFile).not.toHaveBeenCalled();
  });

  it("says once when the page cannot open, and does not try that tab again", async () => {
    const page = setup({ fail: true });
    await page.settle();
    expect(Notice.shown).toHaveLength(1);

    page.fire("layout-change");
    await page.settle();
    expect(page.current()?.openFile).toHaveBeenCalledTimes(1);
    expect(Notice.shown).toHaveLength(1);
  });

  it("does nothing without a current tab", async () => {
    const page = setup();
    page.show(null);
    await page.settle();
    expect(Notice.shown).toEqual([]);
  });

  it("stops looking once unloaded", async () => {
    const page = setup();
    page.unload();
    await page.settle();
    expect(page.current()?.openFile).not.toHaveBeenCalled();
  });

  describe("open", () => {
    it("opens the page in the current tab, whatever it shows", async () => {
      const page = setup();
      const note = page.leaf("markdown");
      page.show(note);
      await page.controller.open();
      expect(note.openFile).toHaveBeenCalledTimes(1);
    });

    it("says so when the file is gone, and nothing when the page is off", async () => {
      await setup({ files: [] }).controller.open();
      expect(Notice.shown).toHaveLength(1);

      Notice.shown = [];
      await setup({ startPage: "" }).controller.open();
      expect(Notice.shown).toEqual([]);
    });
  });

  describe("create", () => {
    it("writes the starter note, with the folders it needs and .md added", async () => {
      const page = setup({ files: [], startPage: "Home/Pages/Start" });
      expect(await page.controller.create()).toBe("Home/Pages/Start.md");
      expect(page.folders).toEqual(["Home", "Home/Pages"]);
      expect(page.created[0]?.path).toBe("Home/Pages/Start.md");
      expect(page.created[0]?.text).toContain("```" + HOME_LANGUAGE);
    });

    it("creates nothing while the page is off", async () => {
      const page = setup({ startPage: "" });
      expect(await page.controller.create()).toBeNull();
      expect(page.created).toEqual([]);
    });

    it("says so when the vault refuses", async () => {
      const page = setup({ files: ["Start.md"] });
      const vault = (page.controller as unknown as { app: { vault: { create: unknown } } }).app
        .vault;
      vault.create = vi.fn(async () => {
        throw new Error("exists");
      });
      expect(await page.controller.create()).toBeNull();
      expect(Notice.shown).toHaveLength(1);
    });
  });
});
