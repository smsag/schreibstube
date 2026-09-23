import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile, TFolder } from "../testing/obsidian-stub";
import { ExplorerController, TRASH_GRACE_MS } from "./explorer-controller";
import type { ExplorerHooks } from "./explorer-controller";
import type { ExplorerFileStore } from "../services/explorer-store";
import { NULL_LOGGER } from "../services/logger";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { setLanguage } from "../i18n";

/** The state file, in memory: the controller writes icons and pins to it. */
class MemoryFile implements ExplorerFileStore {
  text: string | null = null;
  async read(): Promise<string | null> {
    return this.text;
  }
  async write(text: string): Promise<void> {
    this.text = text;
  }
  async mtime(): Promise<number | null> {
    return this.text === null ? null : 1;
  }
}

/**
 * Timers under the test's thumb: nothing fires until `fire` is called, and
 * a cleared handle never fires at all — which is how "the timer was owned"
 * becomes an assertion rather than a hope.
 */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    pending,
    hooks: {
      setTimer: (callback: () => void): unknown => {
        const handle = next++;
        pending.set(handle, callback);
        return handle;
      },
      clearTimer: (handle: unknown): void => {
        pending.delete(handle as number);
      }
    } satisfies ExplorerHooks,
    /** Run every timer set so far, as time passing would. */
    fire(): void {
      for (const [handle, callback] of [...pending]) {
        pending.delete(handle);
        callback();
      }
    }
  };
}

function folder(path: string, children: (TFile | TFolder)[] = []): TFolder {
  return Object.assign(new TFolder(path), { children, name: path.split("/").pop() ?? path });
}

interface Fixture {
  controller: ExplorerController;
  timers: ReturnType<typeof fakeTimers>;
  trashFile: ReturnType<typeof vi.fn>;
  /** What the confirm dialog was asked, in order. */
  asked: string[];
  redraws: number;
}

function fixture(options: { trashFails?: boolean; decline?: boolean } = {}): Fixture {
  const timers = fakeTimers();
  const trashFile = vi.fn(async () => {
    if (options.trashFails) throw new Error("no trash on this volume");
  });
  const asked: string[] = [];
  const state = { redraws: 0 };

  const app = {
    vault: {
      getRoot: () => folder(""),
      getAbstractFileByPath: () => null
    },
    fileManager: { trashFile },
    metadataCache: { getFileCache: () => null }
  } as unknown as App;

  const controller = new ExplorerController(
    app,
    () => DEFAULT_SETTINGS,
    {
      checkFile: async () => ({ checked: 0, changed: 0, failed: 0 }) as never,
      checkFolder: async () => ({ checked: 0, changed: 0, failed: 0 }) as never,
      forget: async () => {}
    },
    NULL_LOGGER,
    new MemoryFile(),
    {
      ...timers.hooks,
      // The dialog answers at once, one way or the other, and remembers what
      // it was asked so the wording can be checked.
      confirm: (dialog, onConfirm) => {
        asked.push(dialog.message);
        if (!options.decline) onConfirm();
      }
    }
  );
  controller.onChange(() => {
    state.redraws += 1;
  });

  return {
    controller,
    timers,
    trashFile,
    asked,
    get redraws() {
      return state.redraws;
    }
  };
}

/** Confirm a delete and let the trash call settle. */
async function deleteViaMenu(controller: ExplorerController, file: TFile | TFolder): Promise<void> {
  await controller.run("delete", file as never);
  // `trashFile` resolves on a later tick; the row is hidden in its `.then`.
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  setLanguage("en");
  Notice.shown = [];
});

describe("deleting from the pane", () => {
  it("asks first, naming the file", async () => {
    const f = fixture();

    await deleteViaMenu(f.controller, new TFile("Notizen/Entwurf.md"));

    expect(f.asked).toEqual(['Move "Entwurf.md" to the trash?']);
    expect(f.trashFile).toHaveBeenCalledTimes(1);
  });

  it("asks with a count for a folder, so the size of the delete is in the question", async () => {
    const f = fixture();
    const target = folder("Projekt", [
      new TFile("Projekt/a.md"),
      folder("Projekt/Unter", [new TFile("Projekt/Unter/b.md")])
    ]);

    await deleteViaMenu(f.controller, target);

    expect(f.asked[0]).toContain("3 item(s)");
  });

  it("does nothing when the person declines", async () => {
    const f = fixture({ decline: true });

    await deleteViaMenu(f.controller, new TFile("Entwurf.md"));

    expect(f.trashFile).not.toHaveBeenCalled();
    expect(f.controller.isTrashed("Entwurf.md")).toBe(false);
  });

  it("takes the row away the moment the trash call returns, before the vault says so", async () => {
    const f = fixture();

    await deleteViaMenu(f.controller, new TFile("Entwurf.md"));

    expect(f.controller.isTrashed("Entwurf.md")).toBe(true);
    expect(f.redraws).toBeGreaterThan(0);
  });

  it("holds back everything under a trashed folder", async () => {
    const f = fixture();

    await deleteViaMenu(f.controller, folder("Projekt"));

    expect(f.controller.isTrashed("Projekt")).toBe(true);
    expect(f.controller.isTrashed("Projekt/Unter/b.md")).toBe(true);
    expect(f.controller.isTrashed("Projektplan.md")).toBe(false);
  });

  it("says so when the trash refuses, and hides nothing", async () => {
    const f = fixture({ trashFails: true });

    await deleteViaMenu(f.controller, new TFile("Entwurf.md"));

    expect(f.controller.isTrashed("Entwurf.md")).toBe(false);
    expect(Notice.shown.join(" ")).toContain("could not be deleted");
  });
});

describe("the grace between the trash call and the vault's own event", () => {
  it("ends when the vault reports the delete, and cancels the timer", async () => {
    const f = fixture();
    await deleteViaMenu(f.controller, new TFile("Entwurf.md"));
    expect(f.timers.pending.size).toBe(1);

    f.controller.handleDelete(new TFile("Entwurf.md") as never);

    expect(f.controller.isTrashed("Entwurf.md")).toBe(false);
    expect(f.timers.pending.size).toBe(0);
  });

  it("gives the row back when no delete event ever arrives", async () => {
    const f = fixture();
    await deleteViaMenu(f.controller, new TFile("Entwurf.md"));
    const before = f.redraws;

    f.timers.fire();

    expect(f.controller.isTrashed("Entwurf.md")).toBe(false);
    expect(f.redraws).toBe(before + 1);
  });

  it("is TRASH_GRACE_MS long", () => {
    expect(TRASH_GRACE_MS).toBe(10_000);
  });

  it("ends for a folder when a file is created under it again", async () => {
    // The bug: a sync client refilling a trashed folder within the grace
    // cleared only the file's own path, and the folder above it stayed
    // hidden — children and all — until the timer gave up.
    const f = fixture();
    await deleteViaMenu(f.controller, folder("Projekt"));
    expect(f.controller.isTrashed("Projekt/neu.md")).toBe(true);

    f.controller.handleCreate(new TFile("Projekt/neu.md") as never);

    expect(f.controller.isTrashed("Projekt")).toBe(false);
    expect(f.controller.isTrashed("Projekt/neu.md")).toBe(false);
    expect(f.timers.pending.size).toBe(0);
  });

  it("ends when something is renamed onto the trashed path", async () => {
    // The other half of the same bug: a rename had no handling at all.
    const f = fixture();
    await deleteViaMenu(f.controller, new TFile("Notizen.md"));

    f.controller.handleRename(new TFile("Notizen.md") as never, "Entwurf.md");

    expect(f.controller.isTrashed("Notizen.md")).toBe(false);
  });

  it("does not clear a trashed folder when the vault reports one of its files gone", async () => {
    // A folder trashed as a whole may be reported file by file. Clearing the
    // folder on the first would draw it again, half-emptied.
    const f = fixture();
    await deleteViaMenu(f.controller, folder("Projekt"));

    f.controller.handleDelete(new TFile("Projekt/a.md") as never);

    expect(f.controller.isTrashed("Projekt")).toBe(true);
    expect(f.controller.isTrashed("Projekt/b.md")).toBe(true);
  });

  it("takes every pending timer back on stop, so nothing fires into a dead controller", async () => {
    const f = fixture();
    await deleteViaMenu(f.controller, new TFile("Eins.md"));
    await deleteViaMenu(f.controller, new TFile("Zwei.md"));
    expect(f.timers.pending.size).toBe(2);

    await f.controller.stop();

    expect(f.timers.pending.size).toBe(0);
    expect(f.controller.isTrashed("Eins.md")).toBe(false);
  });
});
