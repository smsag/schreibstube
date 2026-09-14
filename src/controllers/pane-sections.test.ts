import { beforeEach, describe, expect, it } from "vitest";
import { PaneSectionsController } from "./pane-sections";
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
    saveLocalStorage: (key: string, value: unknown) => void store.set(key, value)
  };
}

const SILENT = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function record(changedAt: number): SyncRecord {
  return { hash: "h", etag: "", checkedAt: changedAt, pendingChanges: 0, changedAt };
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
});
