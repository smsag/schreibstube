// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice } from "../testing/obsidian-stub";
import { installObsidianDom } from "../testing/obsidian-dom";
import { fakeVault } from "../testing/fake-app";
import { DEFAULT_DUE_KEYS } from "../services/due-date";
import { parseHomeBlock, type HomeBlock } from "../services/home-block";
import type { Bookmark } from "../services/bookmark-file";
import { HomeBlockChild, type HomeHost, type HomeSources } from "./home-block";

const SILENT = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const BOOKMARK: Bookmark = { name: "Site", url: "https://example.com", kind: "web" };

function setup(source: string, options: { commands?: string[]; missing?: boolean } = {}) {
  const vault = fakeVault({
    notes: [
      { path: "Late.md", content: "", frontmatter: { schreibstubeDue: "2020-01-01" } },
      { path: "Plain.md", content: "" }
    ]
  });
  const listeners = new Set<() => void>();
  const sources: HomeSources = {
    bookmarkEntries: () => [{ bookmark: BOOKMARK, folderPath: "" }],
    bookmarksFileMissing: () => options.missing === true,
    bookmarksPath: () => "Bookmarks.md",
    latestFiles: () => ({ synced: [{ path: "Plain.md", name: "Plain", syncedAt: 1 }] }),
    openBookmark: vi.fn(),
    pluginIconFor: () => null,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  const commands = Object.fromEntries((options.commands ?? []).map((id) => [id, { id }]));
  const executeCommandById = vi.fn((id: string) => id in commands);
  const events: string[] = [];
  const leaf = { openFile: vi.fn(async () => {}) };
  const app = {
    ...vault.app,
    vault: {
      ...vault.app.vault,
      on: (name: string) => {
        events.push(`vault:${name}`);
        return {};
      }
    },
    metadataCache: {
      ...vault.app.metadataCache,
      on: (name: string) => {
        events.push(`cache:${name}`);
        return {};
      }
    },
    workspace: { ...vault.app.workspace, getLeaf: () => leaf },
    commands: { commands, executeCommandById }
  };
  const host: HomeHost = {
    sources: () => sources,
    dueKeys: () => DEFAULT_DUE_KEYS,
    newNote: vi.fn(),
    logger: SILENT
  };
  const el = document.body.createDiv();
  const block: HomeBlock = parseHomeBlock(source);
  const child = new HomeBlockChild(app as unknown as App, el, block, host);
  child.load();
  return {
    el,
    child,
    host,
    sources,
    leaf,
    events,
    executeCommandById,
    changed: () => listeners.forEach((listener) => listener()),
    listeners,
    rows: (section: string) =>
      Array.from(
        el.querySelectorAll<HTMLElement>(`[data-section="${section}"] .schreibstube-home-row`)
      ),
    buttons: () =>
      Array.from(el.querySelectorAll<HTMLButtonElement>(".schreibstube-home-action")).map(
        (button) => button.textContent
      )
  };
}

beforeAll(() => installObsidianDom());

beforeEach(() => {
  vi.useFakeTimers();
  Notice.shown = [];
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the home block", () => {
  it("draws every section of an empty block", () => {
    const home = setup("", { commands: ["switcher:open"] });
    const kinds = Array.from(home.el.querySelectorAll<HTMLElement>("[data-section]")).map(
      (el) => el.dataset.section
    );
    expect(kinds).toEqual(["actions", "bookmarks", "updated", "due"]);
    expect(
      home.rows("bookmarks").map((row) => row.querySelector(".schreibstube-home-name")?.textContent)
    ).toEqual(["Site"]);
    expect(home.rows("updated").map((row) => row.dataset.path)).toEqual(["Plain.md"]);
    expect(home.rows("due").map((row) => row.dataset.path)).toEqual(["Late.md"]);
  });

  it("draws only the buttons whose command is there", () => {
    const home = setup("actions", { commands: ["switcher:open", "canvas:new-file"] });
    expect(home.buttons()).toEqual(["New note", "Go to file", "New canvas"]);
  });

  it("runs the plugin's own New note, and a core command by id", () => {
    const home = setup("actions", { commands: ["switcher:open"] });
    const [newNote, goTo] = Array.from(
      home.el.querySelectorAll<HTMLButtonElement>(".schreibstube-home-action")
    );
    newNote?.click();
    goTo?.click();
    expect(home.host.newNote).toHaveBeenCalledTimes(1);
    expect(home.executeCommandById).toHaveBeenCalledWith("switcher:open");
    expect(Notice.shown).toEqual([]);
  });

  it("says so when a command it drew has gone since", () => {
    const home = setup("actions go-to-file", { commands: ["switcher:open"] });
    home.executeCommandById.mockReturnValue(false);
    home.el.querySelector<HTMLButtonElement>(".schreibstube-home-action")?.click();
    expect(Notice.shown).toHaveLength(1);
  });

  it("opens a note in this tab, or a new one with the modifier", async () => {
    const home = setup("due");
    const [row] = home.rows("due");
    row?.click();
    row?.dispatchEvent(new MouseEvent("click", { metaKey: true, bubbles: true }));
    await vi.runAllTimersAsync();
    expect(home.leaf.openFile).toHaveBeenCalledTimes(2);
  });

  it("opens a bookmark through the pane, and from the keyboard", () => {
    const home = setup("bookmarks");
    const [row] = home.rows("bookmarks");
    row?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(home.sources.openBookmark).toHaveBeenCalledWith(BOOKMARK);
  });

  it("says the bookmarks file is missing rather than showing an empty list", () => {
    const home = setup("bookmarks", { missing: true });
    expect(home.el.textContent).toContain("Bookmarks.md");
    expect(home.rows("bookmarks")).toEqual([]);
  });

  it("names the lines it did not understand", () => {
    const home = setup("bookmarks\nrecent");
    expect(home.el.querySelector(".schreibstube-home-hint")?.textContent).toContain("Line 2");
  });

  it("listens for due days only when it lists them", () => {
    expect(setup("due").events).toContain("cache:changed");
    expect(setup("bookmarks").events).not.toContain("cache:changed");
  });

  it("draws again once a burst of changes is over, and stops when unloaded", async () => {
    const home = setup("bookmarks");
    const draw = vi.spyOn(home.child, "draw");
    home.changed();
    home.changed();
    await vi.runAllTimersAsync();
    expect(draw).toHaveBeenCalledTimes(1);

    home.child.unload();
    expect(home.listeners.size).toBe(0);
  });
});
