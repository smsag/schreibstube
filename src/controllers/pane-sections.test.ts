import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { PaneSectionsController, RETIRED_STORAGE_KEYS } from "./pane-sections";
import { fakeVault } from "../testing/fake-app";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import type { SchreibstubeSettings } from "../types";
import type { SyncRecord } from "../services/sync-document";

/** Obsidian's per-device store, as a map a test can look inside. */
function fakeStorage() {
  const store = new Map<string, unknown>();
  return {
    store,
    loadLocalStorage: (key: string) => store.get(key) ?? null,
    // Obsidian clears an entry saved as null, so the fake does too.
    saveLocalStorage: (key: string, value: unknown) =>
      void (value === null ? store.delete(key) : store.set(key, value))
  };
}

const SILENT = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** A source that moved at `changedAt`, with the update not yet in the note. */
function record(changedAt: number): SyncRecord {
  return {
    hash: "note",
    remoteHash: "source",
    etag: "",
    checkedAt: changedAt,
    pendingChanges: 0,
    changedAt
  };
}

/** A source that moved at `changedAt`, and a note already level with it. */
function levelRecord(changedAt: number): SyncRecord {
  return { ...record(changedAt), hash: "source" };
}

function controllerFor(
  syncState: Record<string, SyncRecord>,
  storage = fakeStorage()
): { pane: PaneSectionsController; storage: ReturnType<typeof fakeStorage> } {
  const vault = fakeVault({
    notes: [
      { path: "Quellen/Eins.md", content: "# Eins" },
      { path: "Quellen/Zwei.md", content: "# Zwei" }
    ]
  });
  const app = Object.assign(vault.app, storage);
  const settings: SchreibstubeSettings = { ...DEFAULT_SETTINGS, syncState };

  const pane = new PaneSectionsController(
    app as never,
    () => settings,
    SILENT as never,
    () => {}
  );

  return { pane, storage };
}

describe("the mark that a source changed", () => {
  let now: number;

  beforeEach(() => {
    now = Date.now();
  });

  it("says nothing on a device seeing this version for the first time", async () => {
    // A vault full of notes whose sources changed last week is not news, and a
    // mark raised for all of it at once would be a mark nobody believes.
    const { pane } = controllerFor({ "Quellen/Eins.md": record(now - 1000) });
    await pane.start();

    expect(pane.syncAlert()).toBe(false);
  });

  it("shows once a source changes after that", async () => {
    const state: Record<string, SyncRecord> = { "Quellen/Eins.md": record(now - 1000) };
    const { pane } = controllerFor(state);
    await pane.start();
    pane.syncAlert();

    state["Quellen/Zwei.md"] = record(now);
    pane.invalidateLatest();

    expect(pane.syncAlert()).toBe(true);
  });

  it("comes down when it is acknowledged, and stays down", async () => {
    const state: Record<string, SyncRecord> = { "Quellen/Eins.md": record(now - 1000) };
    const { pane } = controllerFor(state);
    await pane.start();
    pane.syncAlert();

    state["Quellen/Zwei.md"] = record(now);
    pane.invalidateLatest();
    expect(pane.syncAlert()).toBe(true);

    pane.acknowledgeSync();

    expect(pane.syncAlert()).toBe(false);
    expect(pane.syncAlert()).toBe(false);
  });

  it("is remembered across a restart of the app", async () => {
    const storage = fakeStorage();
    const state: Record<string, SyncRecord> = { "Quellen/Eins.md": record(now) };

    const first = controllerFor(state, storage).pane;
    await first.start();
    first.syncAlert();
    state["Quellen/Zwei.md"] = record(now + 1000);
    first.invalidateLatest();
    expect(first.syncAlert()).toBe(true);
    first.acknowledgeSync();

    // A new session over the same device store: what was acknowledged stays so.
    const second = controllerFor(state, storage).pane;
    await second.start();

    expect(second.syncAlert()).toBe(false);
  });

  it("shows again for the next change after one was acknowledged", async () => {
    const state: Record<string, SyncRecord> = { "Quellen/Eins.md": record(now) };
    const { pane } = controllerFor(state);
    await pane.start();
    pane.syncAlert();

    state["Quellen/Zwei.md"] = record(now + 1000);
    pane.invalidateLatest();
    pane.acknowledgeSync();
    expect(pane.syncAlert()).toBe(false);

    state["Quellen/Eins.md"] = record(now + 2000);
    pane.invalidateLatest();

    expect(pane.syncAlert()).toBe(true);
  });

  it("says nothing about a vault whose sources have never changed", async () => {
    const { pane } = controllerFor({});
    await pane.start();

    expect(pane.syncAlert()).toBe(false);
  });

  it("says nothing for a source whose update the note already holds", async () => {
    // What a device whose records were behind used to report: another device
    // had fetched and accepted the update, the note arrived by vault sync, and
    // the check here saw the source move past its stale record. Nothing is
    // left for "Quelle prüfen" to show, so there is nothing to mark.
    const state: Record<string, SyncRecord> = { "Quellen/Eins.md": record(now - 1000) };
    const { pane } = controllerFor(state);
    await pane.start();
    pane.syncAlert();

    state["Quellen/Zwei.md"] = levelRecord(now);
    pane.invalidateLatest();

    expect(pane.syncAlert()).toBe(false);
    expect(pane.latestFiles().synced.map((file) => file.path)).toEqual(["Quellen/Eins.md"]);
  });

  it("drops a note from the list once its update is taken", async () => {
    const state: Record<string, SyncRecord> = { "Quellen/Eins.md": record(now) };
    const { pane } = controllerFor(state);
    await pane.start();
    expect(pane.latestFiles().synced.map((file) => file.path)).toEqual(["Quellen/Eins.md"]);

    // Accepting every card moves the baseline to the source's text and leaves
    // when the source moved as it was; the list has to notice all the same.
    state["Quellen/Eins.md"] = levelRecord(now);

    expect(pane.latestFiles().synced).toEqual([]);
  });
});

describe("opening a note from the recent lists", () => {
  /** The pane with a workspace that says which leaf it was asked for. */
  function opener() {
    const { pane, storage } = controllerFor({});
    const opened: string[] = [];
    const getLeaf = vi.fn((_kind: unknown) => ({
      openFile: async (file: { path: string }) => opened.push(file.path)
    }));
    Object.assign(pane as unknown as { app: object }, {
      app: Object.assign((pane as unknown as { app: object }).app, { workspace: { getLeaf } })
    });
    return { pane, storage, getLeaf, opened };
  }

  afterEach(() => {
    Platform.isDesktopApp = false;
  });

  it("opens in place, or where the press asked", async () => {
    Platform.isDesktopApp = true;
    const { pane, getLeaf, opened } = opener();
    await pane.openLatest("Quellen/Eins.md");
    await pane.openLatest("Quellen/Eins.md", "split");
    await pane.openLatest("Quellen/Zwei.md", "window");
    expect(getLeaf.mock.calls.map(([kind]) => kind)).toEqual([false, "split", "window"]);
    expect(opened).toEqual(["Quellen/Eins.md", "Quellen/Eins.md", "Quellen/Zwei.md"]);
  });

  it("opens a tab where a phone or a tablet has no second window to give", async () => {
    Platform.isDesktopApp = false;
    const { pane, getLeaf } = opener();
    await pane.openLatest("Quellen/Eins.md", "window");
    expect(getLeaf).toHaveBeenCalledWith("tab");
  });
});

describe("what earlier versions left on a device", () => {
  it("clears the recently opened bookmarks on start", async () => {
    const storage = fakeStorage();
    storage.store.set("schreibstube:bookmarks:recent", ["https://example.com"]);
    const { pane } = controllerFor({}, storage);

    await pane.start();

    expect(storage.store.has("schreibstube:bookmarks:recent")).toBe(false);
  });

  it("writes nothing on a device that holds none of it", async () => {
    const storage = fakeStorage();
    const save = vi.spyOn(storage, "saveLocalStorage");
    const { pane } = controllerFor({}, storage);

    await pane.start();

    for (const key of RETIRED_STORAGE_KEYS) {
      expect(save).not.toHaveBeenCalledWith(key, null);
    }
  });
});

describe("the icon of a plugin a bookmark calls", () => {
  const PYTHIA = {
    id: "p",
    name: "Resume",
    url: "obsidian://pythia?vault=Vault%202.0&cmd=resume&id=71b2",
    kind: "obsidian" as const
  };

  function withCommands(commands: Record<string, unknown>) {
    const { pane } = controllerFor({});
    (pane as unknown as { app: { commands: unknown } }).app.commands = { commands };
    return pane;
  }

  it("reads the icon off the plugin's commands", () => {
    const pane = withCommands({
      "pythia:open": { id: "pythia:open", icon: "pythia-logo" },
      "pythia:star": { id: "pythia:star", icon: "star" },
      "pythia:new": { id: "pythia:new", icon: "pythia-logo" }
    });

    expect(pane.pluginIconFor(PYTHIA)).toBe("pythia-logo");
  });

  it("prefers the plugin's ribbon button to its commands", () => {
    const pane = withCommands({ "pythia:open": { id: "pythia:open", icon: "pythia-logo" } });
    const app = (pane as unknown as { app: { workspace?: unknown } }).app;
    app.workspace = { leftRibbon: { items: [{ id: "pythia:Pythia", icon: "pythia-ribbon" }] } };

    expect(pane.pluginIconFor(PYTHIA)).toBe("pythia-ribbon");
  });

  it("has none for a link Obsidian answers itself, or one of another kind", () => {
    const pane = withCommands({ "open:x": { id: "open:x", icon: "star" } });

    expect(
      pane.pluginIconFor({ ...PYTHIA, url: "obsidian://open?vault=Vault&file=Note" })
    ).toBeNull();
    expect(pane.pluginIconFor({ ...PYTHIA, url: "https://example.com", kind: "web" })).toBeNull();
  });

  it("gives the icon back when the plugin is turned off", () => {
    const commands: Record<string, unknown> = {
      "pythia:open": { id: "pythia:open", icon: "pythia-logo" }
    };
    const pane = withCommands(commands);
    expect(pane.pluginIconFor(PYTHIA)).toBe("pythia-logo");

    // Obsidian takes a plugin's commands away when it is turned off.
    delete commands["pythia:open"];

    expect(pane.pluginIconFor(PYTHIA)).toBeNull();
  });

  it("does not read the registries again while nothing was registered or removed", () => {
    const pane = withCommands({ "other:open": { id: "other:open", icon: "star" } });
    const registry = (pane as unknown as { app: { commands: { commands: object } } }).app.commands;
    let reads = 0;
    const commands = registry.commands;
    Object.defineProperty(registry, "commands", {
      get: () => {
        reads += 1;
        return commands;
      }
    });

    pane.pluginIconFor(PYTHIA);
    const afterFirst = reads;
    pane.pluginIconFor(PYTHIA);

    // The second look only counts; it does not scan for the icon again.
    expect(reads - afterFirst).toBeLessThan(afterFirst);
    expect(pane.pluginIconFor(PYTHIA)).toBeNull();
  });

  it("finds the icon of a plugin that loaded after the first look", () => {
    const pane = withCommands({});
    expect(pane.pluginIconFor(PYTHIA)).toBeNull();

    (pane as unknown as { app: { commands: unknown } }).app.commands = {
      commands: { "pythia:open": { id: "pythia:open", icon: "pythia-logo" } }
    };
    expect(pane.pluginIconFor(PYTHIA)).toBe("pythia-logo");
  });
});

describe("opening a note bookmark", () => {
  function paneWithWorkspace(openFile: (file: unknown, state?: unknown) => Promise<void>) {
    const { pane } = controllerFor({});
    const app = (pane as unknown as { app: Record<string, unknown> }).app;
    app.workspace = { getLeaf: () => ({ openFile }) };
    return pane;
  }

  it("opens the note at the heading the bookmark names", async () => {
    const openFile = vi.fn(async () => {});
    const pane = paneWithWorkspace(openFile);

    pane.openBookmark({ name: "Eins", url: "note://Quellen/Eins#Ziele", kind: "note" });
    await vi.waitFor(() => expect(openFile).toHaveBeenCalled());

    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Quellen/Eins.md" }), {
      eState: { subpath: "#Ziele" }
    });
  });

  it("opens a note without a heading at its top", async () => {
    const openFile = vi.fn(async () => {});
    const pane = paneWithWorkspace(openFile);

    pane.openBookmark({ name: "Eins", url: "note://Quellen/Eins", kind: "note" });
    await vi.waitFor(() => expect(openFile).toHaveBeenCalled());

    expect(openFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "Quellen/Eins.md" }),
      undefined
    );
  });

  it("says so when the note cannot be opened, rather than failing unseen", async () => {
    const warn = vi.fn();
    const { pane } = controllerFor({});
    const internals = pane as unknown as { app: Record<string, unknown>; logger: unknown };
    internals.logger = { ...SILENT, warn };
    internals.app.workspace = {
      getLeaf: () => ({
        openFile: async () => {
          throw new Error("view failed");
        }
      })
    };

    pane.openBookmark({ name: "Eins", url: "note://Quellen/Eins", kind: "note" });

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});
