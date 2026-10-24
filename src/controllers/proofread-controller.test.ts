// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { fakeVault } from "../testing/fake-app";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { createLogger } from "../services/logger";
import type { ReviewState } from "../ui/review-panel";
import type { SyncRecord } from "../services/sync-document";
import { ProofreadController, type SyncStore } from "./proofread-controller";

function memoryStore(): SyncStore {
  let records: Record<string, SyncRecord> = {};
  return {
    get: (path) => records[path],
    set: async (path, record) => void (records = { ...records, [path]: record }),
    setMany: async (more) => void (records = { ...records, ...more }),
    forget: async (path) => {
      const { [path]: _gone, ...rest } = records;
      records = rest;
    },
    all: () => records,
    update: async (transform) => {
      const next = transform(records);
      if (next !== null) records = next;
    }
  };
}

/** One note open, not bound to any source, under review. */
async function reviewing(path: string) {
  const vault = fakeVault({ notes: [{ path, content: "Text." }] });
  const file = vault.file(path);
  const app = {
    ...vault.app,
    vault: { ...vault.app.vault, getFiles: () => [file] },
    workspace: { ...vault.app.workspace, getActiveFile: () => file }
  } as unknown as App;
  const controller = new ProofreadController(
    app,
    () => DEFAULT_SETTINGS,
    createLogger(() => false),
    memoryStore()
  );
  const states: ReviewState[] = [];
  controller.onStateChange((state) => states.push(state));
  await controller.syncActiveFile();
  return { controller, file, states };
}

describe("ProofreadController, a note under review moved", () => {
  it("keeps the note under review when it is renamed without a sync record", async () => {
    const { controller, file, states } = await reviewing("Alt.md");
    file.path = "Neu.md";
    await controller.handleNoteRenamed("Alt.md", "Neu.md");
    expect(states.at(-1)?.fileName).toBe("Neu.md");
  });

  it("keeps the queue when the folder holding the note moves", async () => {
    const { controller, file, states } = await reviewing("Projekt/Brief.md");
    // A card already in the queue, as a finished pass leaves it.
    (controller as unknown as { suggestions: unknown[] }).suggestions = [{ id: "s1" }];
    file.path = "Archiv/Brief.md";
    await controller.handleNoteRenamed("Projekt", "Archiv");
    await controller.syncActiveFile();
    expect(states.at(-1)?.suggestions).toHaveLength(1);
  });
});
