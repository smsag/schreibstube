import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  renameFile: ReturnType<typeof vi.fn>;
  createBinary: ReturnType<typeof vi.fn>;
  /** What the confirm dialog was asked, in order. */
  asked: string[];
  /** Every notice that carried an undo, and the undo itself. */
  toasts: { message: string; undo: () => void }[];
  /** The vault's own trash, as the adapter sees it. */
  trash: string[];
  /** Paths the vault holds, as far as the fake knows. */
  present: Set<string>;
  clock: { now: number };
  redraws: number;
}

interface FixtureOptions {
  trashFails?: boolean;
  decline?: boolean;
  /** The trash is the system's: nothing ever appears in `.trash`. */
  systemTrash?: boolean;
  /** Entries already in the trash before the delete, as the adapter lists them. */
  trashHolds?: string[];
  /** Something another device drops into the trash during every delete. */
  strayTrash?: string;
  present?: string[];
  /** Settings other than the defaults, for the marks that read them. */
  settings?: Partial<typeof DEFAULT_SETTINGS>;
  /** Frontmatter by path, as the metadata cache would hand it over. */
  frontmatter?: Record<string, Record<string, unknown>>;
  /** Obsidian's resolved-link table, for the related notes. */
  links?: Record<string, Record<string, number>>;
  /** Each note's tags, `#` included, as Obsidian reports them. */
  tags?: Record<string, string[]>;
  /** Each note's list items, a task's box character in `task`. */
  listItems?: Record<string, { task?: string }[]>;
  /** File contents by path, for the actions that read a file. */
  contents?: Record<string, string>;
}

function fixture(options: FixtureOptions = {}): Fixture {
  const timers = fakeTimers();
  const trash: string[] = [...(options.trashHolds ?? [])];
  // What each entry the fake trash moved there looked like; anything else in
  // the trash is a stranger, with a size no file of the tests has.
  const arrivals = new Map<string, { type: "file" | "folder"; size: number; mtime: number }>();
  const present = new Set(options.present ?? []);
  const trashFile = vi.fn(async (file: TFile | TFolder) => {
    if (options.trashFails) throw new Error("no trash on this volume");
    present.delete(file.path);
    if (options.strayTrash) trash.push(options.strayTrash);
    if (options.systemTrash) return;
    // As the vault's trash does: the name is kept, and a namesake already
    // there makes the arrival take a numbered one.
    const name = file.path.split("/").pop() ?? file.path;
    const wanted = `.trash/${name}`;
    const landed = trash.includes(wanted) ? wanted.replace(/(\.[^.]+)$/, " 1$1") : wanted;
    trash.push(landed);
    arrivals.set(
      landed,
      file instanceof TFile
        ? { type: "file", size: file.stat.size, mtime: file.stat.mtime }
        : { type: "folder", size: 0, mtime: 0 }
    );
  });
  const renameFile = vi.fn(async (file: TFile | TFolder, to: string) => {
    present.delete(file.path);
    present.add(to);
    file.path = to;
  });
  const createBinary = vi.fn(async (path: string) => {
    present.add(path);
  });
  // A folder answers with its children, as the vault's does: the tile grid
  // and the folder count read them, and a folder without them is a file.
  const node = (path: string): TFile | TFolder => {
    if (/\.[^/]+$/.test(path)) return new TFile(path);
    const prefix = path.length > 0 ? `${path}/` : "";
    const children = [...present]
      .filter((p) => p.startsWith(prefix) && p !== path && !p.slice(prefix.length).includes("/"))
      .map(node);
    return folder(path, children);
  };
  const asked: string[] = [];
  const toasts: { message: string; undo: () => void }[] = [];
  const clock = { now: 1_000_000 };
  const state = { redraws: 0 };

  const app = {
    vault: {
      getRoot: () => folder(""),
      getAbstractFileByPath: (path: string) => (present.has(path) ? node(path) : null),
      getFileByPath: (path: string) => {
        const found = present.has(path) ? node(path) : null;
        return found instanceof TFile ? found : null;
      },
      getAllLoadedFiles: () => [...present].map(node),

      getMarkdownFiles: () => [...present].filter((p) => p.endsWith(".md")).map(node),
      createBinary,
      cachedRead: async (file: TFile) => {
        const text = options.contents?.[file.path];
        if (text === undefined) throw new Error(`nothing at ${file.path}`);
        return text;
      },
      adapter: {
        exists: async (path: string) =>
          path === ".trash" ? trash.length > 0 : trash.includes(path) || present.has(path),
        list: async () => ({ files: [...trash], folders: [] }),
        stat: async (path: string) =>
          trash.includes(path)
            ? (arrivals.get(path) ?? { type: "file", size: 4096, mtime: 1 })
            : null,
        rename: async (from: string, to: string) => {
          const at = trash.indexOf(from);
          if (at === -1) throw new Error(`nothing at ${from}`);
          trash.splice(at, 1);
          present.add(to);
        }
      }
    },
    fileManager: { trashFile, renameFile },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const frontmatter = options.frontmatter?.[file.path];
        const tags = options.tags?.[file.path];
        const listItems = options.listItems?.[file.path];
        return frontmatter || tags || listItems
          ? {
              ...(frontmatter ? { frontmatter } : {}),
              ...(tags ? { tags } : {}),
              ...(listItems ? { listItems } : {})
            }
          : null;
      },
      getFirstLinkpathDest: (link: string) => (present.has(link) ? node(link) : null),
      resolvedLinks: options.links ?? {}
    }
  } as unknown as App;

  const settings = { ...DEFAULT_SETTINGS, ...options.settings };
  const controller = new ExplorerController(
    app,
    () => settings,
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
      },
      toast: (message, _label, undo) => {
        toasts.push({ message, undo });
      },
      // The picker is a modal; here it takes the first real folder offered.
      pickFolder: (folders, _title, onPick) => onPick(folders.find((f) => f !== "") ?? ""),
      now: () => clock.now
    }
  );
  controller.onChange(() => {
    state.redraws += 1;
  });

  return {
    controller,
    timers,
    trashFile,
    renameFile,
    createBinary,
    asked,
    toasts,
    trash,
    present,
    clock,
    get redraws() {
      return state.redraws;
    }
  };
}

/** Confirm a delete and let the trash call settle. */
async function deleteViaMenu(controller: ExplorerController, file: TFile | TFolder): Promise<void> {
  await controller.run("delete", file as never);
  // The trash runs after the confirm returns, over a few awaits of its own.
  await settle();
}

/** Let every pending promise in the flow run to its end. A macrotask drains
 *  the whole microtask queue, however many awaits a batch of three has. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("takes the row away before the trash call has returned", async () => {
    const f = fixture();
    let released: () => void = () => undefined;
    f.trashFile.mockImplementationOnce(() => new Promise<void>((resolve) => (released = resolve)));

    await f.controller.run("delete", new TFile("Entwurf.md") as never);
    await settle();

    expect(f.controller.isTrashed("Entwurf.md")).toBe(true);
    released();
    await settle();
    expect(f.controller.isTrashed("Entwurf.md")).toBe(true);
  });

  it("finds the entry when a namesake already sits in the trash", async () => {
    const f = fixture({ present: ["a.md"], trashHolds: [".trash/a.md"] });

    await deleteViaMenu(f.controller, new TFile("a.md"));

    expect(f.trash).toEqual([".trash/a.md", ".trash/a 1.md"]);
    f.toasts[0]?.undo();
    await settle();
    expect(f.trash).toEqual([".trash/a.md"]);
    expect(f.present.has("a.md")).toBe(true);
  });

  it("offers no undo for a namesake that lands where the file was expected", async () => {
    // The bug: with the system trash, a sync client dropping a note of the
    // same name into `.trash` during the call was taken for the receipt, and
    // the undo would have moved that stranger onto the deleted note's path.
    const f = fixture({ present: ["a.md"], systemTrash: true, strayTrash: ".trash/a.md" });

    await deleteViaMenu(f.controller, new TFile("a.md"));

    expect(f.toasts).toEqual([]);
    expect(Notice.shown.join(" ")).toContain("system trash");
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

  it("does not start until the trash call has returned", async () => {
    // The bug: the grace began at the confirm, and a call slower than it —
    // or the last of a long batch — brought its row back mid-delete.
    const f = fixture();
    let released: () => void = () => undefined;
    f.trashFile.mockImplementationOnce(() => new Promise<void>((resolve) => (released = resolve)));

    await f.controller.run("delete", new TFile("Entwurf.md") as never);
    await settle();
    expect(f.timers.pending.size).toBe(0);
    f.timers.fire();
    expect(f.controller.isTrashed("Entwurf.md")).toBe(true);

    released();
    await settle();
    expect(f.timers.pending.size).toBe(1);
    expect(f.controller.isTrashed("Entwurf.md")).toBe(true);
  });

  it("does not start for a row the vault confirmed during the call", async () => {
    const f = fixture();
    let released: () => void = () => undefined;
    f.trashFile.mockImplementationOnce(() => new Promise<void>((resolve) => (released = resolve)));

    await f.controller.run("delete", new TFile("Entwurf.md") as never);
    await settle();
    f.controller.handleDelete(new TFile("Entwurf.md") as never);
    released();
    await settle();

    expect(f.timers.pending.size).toBe(0);
    expect(f.controller.isTrashed("Entwurf.md")).toBe(false);
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

describe("deleting several rows at once", () => {
  it("asks once, with the count, and trashes each", async () => {
    const f = fixture({ present: ["a.md", "b.md", "c.md"] });

    f.controller.removeMany([new TFile("a.md"), new TFile("b.md"), new TFile("c.md")] as never);
    await settle();

    expect(f.asked).toEqual(["Move 3 items to the trash?"]);
    expect(f.trashFile).toHaveBeenCalledTimes(3);
    expect(f.controller.isTrashed("b.md")).toBe(true);
  });

  it("falls back to the single-row question for one row", async () => {
    const f = fixture({ present: ["a.md"] });

    f.controller.removeMany([new TFile("a.md")] as never);
    await settle();

    expect(f.asked).toEqual(['Move "a.md" to the trash?']);
  });
});

describe("deleting a described picture", () => {
  const note = "Bildbeschreibungen/see.jpg – 1234.md";
  const described = () =>
    fixture({
      present: ["Bilder/see.jpg", note],
      frontmatter: { [note]: { schreibstubeImage: "[[Bilder/see.jpg]]" } }
    });

  it("takes the description note along, and names only the picture", async () => {
    const f = described();

    await deleteViaMenu(f.controller, new TFile("Bilder/see.jpg"));

    expect(f.trash).toEqual([".trash/see.jpg", ".trash/see.jpg – 1234.md"]);
    expect(f.toasts[0]?.message).toContain('"see.jpg" moved to the trash');
  });

  it("brings both back with one undo", async () => {
    const f = described();
    await deleteViaMenu(f.controller, new TFile("Bilder/see.jpg"));

    f.toasts[0]?.undo();
    await settle();

    expect(f.present.has("Bilder/see.jpg")).toBe(true);
    expect(f.present.has(note)).toBe(true);
  });

  it("takes the notes of the pictures inside a deleted folder along", async () => {
    const f = described();

    await deleteViaMenu(f.controller, folder("Bilder", [new TFile("Bilder/see.jpg")]));

    expect(f.trash).toEqual([".trash/Bilder", ".trash/see.jpg – 1234.md"]);
  });

  it("leaves a note that sits inside the deleted folder to go with the folder", async () => {
    const inside = "Bilder/see.jpg – 1234.md";
    const f = fixture({
      present: ["Bilder/see.jpg", inside],
      frontmatter: { [inside]: { schreibstubeImage: "[[Bilder/see.jpg]]" } }
    });

    await deleteViaMenu(f.controller, folder("Bilder", [new TFile("Bilder/see.jpg")]));

    expect(f.trash).toEqual([".trash/Bilder"]);
  });
});

describe("the pairing of pictures and their notes", () => {
  const note = "Bildbeschreibungen/see.jpg – 1234.md";
  const described = () =>
    fixture({
      present: ["Bilder/see.jpg", note],
      frontmatter: { [note]: { schreibstubeImage: "[[Bilder/see.jpg]]" } }
    });

  it("folds a description note into its picture, and knows an orphaned one as a description too", () => {
    const paired = described();
    expect(paired.controller.foldsIntoPicture(note)).toBe(true);
    expect(paired.controller.isDescriptionNote(note)).toBe(true);
    expect(paired.controller.isDescriptionNote("Bilder/see.jpg")).toBe(false);

    // Its picture gone: the tree shows it, so it can be seen and repaired,
    // but the search and Recommended leave it out.
    const orphaned = fixture({
      present: [note],
      frontmatter: { [note]: { schreibstubeImage: "[[Bilder/see.jpg]]" } }
    });
    expect(orphaned.controller.foldsIntoPicture(note)).toBe(false);
    expect(orphaned.controller.isDescriptionNote(note)).toBe(true);
  });

  it("forgets a pair when the vault reports its note gone", () => {
    const f = described();
    expect(f.controller.descriptionNoteOf("Bilder/see.jpg")).toBe(note);

    f.present.delete(note);
    f.controller.handleDelete(new TFile(note) as never);

    expect(f.controller.descriptionNoteOf("Bilder/see.jpg")).toBeNull();
  });

  it("forgets a pair when the folder holding its picture is renamed", () => {
    const f = described();
    expect(f.controller.imageDescribedBy(note)).toBe("Bilder/see.jpg");

    f.present.delete("Bilder/see.jpg");
    f.present.add("Urlaub/see.jpg");
    f.controller.handleRename(folder("Urlaub", [new TFile("Urlaub/see.jpg")]) as never, "Bilder");

    expect(f.controller.imageDescribedBy(note)).toBeNull();
  });

  it("makes a pair when a picture appears where an orphaned note points", () => {
    const f = fixture({
      present: [note],
      frontmatter: { [note]: { schreibstubeImage: "[[Bilder/see.jpg]]" } }
    });
    expect(f.controller.descriptionNoteOf("Bilder/see.jpg")).toBeNull();

    f.present.add("Bilder/see.jpg");
    f.controller.handleCreate(new TFile("Bilder/see.jpg") as never);

    expect(f.controller.descriptionNoteOf("Bilder/see.jpg")).toBe(note);
  });

  it("keeps the pairing through a change to an unrelated note", () => {
    const f = described();
    const before = f.controller.descriptionNoteOf("Bilder/see.jpg");

    f.controller.handleDelete(new TFile("Notizen/andere.md") as never);

    expect(f.controller.descriptionNoteOf("Bilder/see.jpg")).toBe(before);
  });
});

describe("undoing a delete", () => {
  it("offers an undo that lifts the file out of the vault's trash", async () => {
    const f = fixture({ present: ["Notizen/Entwurf.md"] });
    await deleteViaMenu(f.controller, new TFile("Notizen/Entwurf.md"));
    expect(f.trash).toEqual([".trash/Entwurf.md"]);
    expect(f.toasts).toHaveLength(1);

    f.toasts[0]?.undo();
    await settle();

    expect(f.trash).toEqual([]);
    expect(f.present.has("Notizen/Entwurf.md")).toBe(true);
    expect(f.controller.isTrashed("Notizen/Entwurf.md")).toBe(false);
  });

  it("offers no undo when the trash is the system's, and says why", async () => {
    const f = fixture({ present: ["a.md"], systemTrash: true });

    await deleteViaMenu(f.controller, new TFile("a.md"));

    expect(f.toasts).toEqual([]);
    expect(Notice.shown.join(" ")).toContain("system trash");
    expect(f.controller.isTrashed("a.md")).toBe(true);
  });

  it("refuses to put a file back over something that is there now", async () => {
    const f = fixture({ present: ["a.md"] });
    await deleteViaMenu(f.controller, new TFile("a.md"));
    f.present.add("a.md");

    f.toasts[0]?.undo();
    await settle();

    expect(f.trash).toEqual([".trash/a.md"]);
    expect(Notice.shown.join(" ")).toContain("could not be put back");
  });

  it("is gone after its window", async () => {
    const f = fixture({ present: ["a.md"] });
    await deleteViaMenu(f.controller, new TFile("a.md"));
    f.clock.now += 31_000;

    await f.controller.undoLast();

    expect(f.trash).toEqual([".trash/a.md"]);
    expect(Notice.shown.join(" ")).toContain("nothing to undo");
  });
});

describe("moving, and undoing a move", () => {
  it("moves a dropped row and offers to move it back", async () => {
    const f = fixture({ present: ["a.md", "Ziel"] });
    const file = new TFile("a.md");

    await f.controller.move(file as never, "Ziel");

    expect(f.renameFile).toHaveBeenCalledWith(expect.anything(), "Ziel/a.md");
    expect(f.toasts[0]?.message).toContain("moved to Ziel");

    f.toasts[0]?.undo();
    await settle();

    expect(f.renameFile).toHaveBeenLastCalledWith(expect.anything(), "a.md");
    expect(Notice.shown.join(" ")).toContain("move was undone");
  });

  it("says nothing for a drop back where the row already was", async () => {
    const f = fixture({ present: ["Ziel/a.md", "Ziel"] });

    await f.controller.move(new TFile("Ziel/a.md") as never, "Ziel");

    expect(f.renameFile).not.toHaveBeenCalled();
    expect(Notice.shown).toEqual([]);
  });

  it("moves several rows and counts them in the notice", async () => {
    const f = fixture({ present: ["a.md", "b.md", "Ziel"] });

    f.controller.runSelection("move-selected", [new TFile("a.md"), new TFile("b.md")] as never);
    await settle();

    expect(f.renameFile).toHaveBeenCalledTimes(2);
    expect(f.toasts.at(-1)?.message).toContain("2 items moved to Ziel");
  });
});

describe("importing files from the desktop", () => {
  const source = (name: string, size = 10, isFolder = false) => ({
    name,
    size,
    isFolder,
    bytes: async () => new ArrayBuffer(size)
  });

  it("writes each file into the folder it was dropped on", async () => {
    const f = fixture({ present: ["Anhänge"] });

    await f.controller.importFiles([source("Scan.pdf"), source("Foto.jpg")], "Anhänge");

    expect(f.createBinary.mock.calls.map((call) => call[0])).toEqual([
      "Anhänge/Scan.pdf",
      "Anhänge/Foto.jpg"
    ]);
    expect(Notice.shown.join(" ")).toContain("2 files imported into Anhänge");
  });

  it("gives a taken name the next free one rather than overwriting", async () => {
    const f = fixture({ present: ["Scan.pdf"] });

    await f.controller.importFiles([source("Scan.pdf")], "");

    expect(f.createBinary).toHaveBeenCalledWith("Scan 1.pdf", expect.anything());
  });

  it("leaves a folder out and says so, while writing the rest", async () => {
    const f = fixture();

    await f.controller.importFiles([source("Photos", 0, true), source("Gut.pdf")], "");

    expect(f.createBinary).toHaveBeenCalledTimes(1);
    expect(Notice.shown.join(" ")).toContain("Photos — a folder");
  });

  it("says which file could not be written, and keeps going", async () => {
    const f = fixture();
    f.createBinary.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });

    await f.controller.importFiles([source("Eins.pdf"), source("Zwei.pdf")], "");

    expect(Notice.shown.join(" ")).toContain("Eins.pdf could not be written");
    expect(Notice.shown.join(" ")).toContain("1 file imported");
  });
});

describe("the review's findings", () => {
  it("keeps two dropped files of one name apart, bytes included", async () => {
    const f = fixture();
    const source = (size: number) => ({
      name: "Foto.jpg",
      size,
      bytes: async () => new ArrayBuffer(size)
    });

    await f.controller.importFiles([source(3), source(7)], "");

    const written = f.createBinary.mock.calls.map(([path, bytes]) => [
      path,
      (bytes as ArrayBuffer).byteLength
    ]);
    expect(written).toEqual([
      ["Foto.jpg", 3],
      ["Foto 1.jpg", 7]
    ]);
  });

  it("lets a notice undo only the action it announced", async () => {
    const f = fixture({ present: ["a.md", "b.md", "Ziel"] });
    await deleteViaMenu(f.controller, new TFile("a.md"));
    await f.controller.move(new TFile("b.md") as never, "Ziel");
    expect(f.toasts).toHaveLength(2);

    // The delete's notice, pressed after the move: it must not undo the move.
    f.toasts[0]?.undo();
    await settle();

    expect(f.trash).toEqual([".trash/a.md"]);
    expect(f.renameFile).toHaveBeenCalledTimes(1);
    expect(Notice.shown.join(" ")).toContain("nothing to undo");
  });

  it("deletes a folder once when a file inside it is selected too", async () => {
    const f = fixture({ present: ["Projekt", "Projekt/a.md"] });

    f.controller.removeMany([folder("Projekt"), new TFile("Projekt/a.md")] as never);
    await settle();

    // One question, about the folder — the file inside it is part of that.
    expect(f.asked).toHaveLength(1);
    expect(f.asked[0]).toContain('"Projekt"');
    expect(f.trashFile).toHaveBeenCalledTimes(1);
    expect(Notice.shown.join(" ")).not.toContain("could not be deleted");
  });

  it("takes as its receipt the arrival with the file's own name, not the first", async () => {
    const f = fixture({ present: ["a.md"], strayTrash: ".trash/Fremd.md" });
    await deleteViaMenu(f.controller, new TFile("a.md"));

    f.toasts[0]?.undo();
    await settle();

    expect(f.trash).toEqual([".trash/Fremd.md"]);
    expect(f.present.has("a.md")).toBe(true);
  });
});

describe("a folder's pictures as tiles", () => {
  it("sends the folder to whoever lays out tiles, and follows from then on", async () => {
    const f = fixture({ present: ["Fotos", "Fotos/a.jpg"] });
    const opened: [string, boolean][] = [];
    f.controller.useFolderTilesOpener(async (folder, following) => {
      opened.push([folder, following]);
    });

    await f.controller.run("show-images", folder("Fotos") as never);
    await f.controller.run("show-images", new TFile("Fotos/a.jpg") as never);

    expect(opened).toEqual([["Fotos", true]]);
  });

  it("tells a listener which folder was pressed, until it stops listening", () => {
    const f = fixture();
    const heard: string[] = [];
    const stop = f.controller.onFolderChosen((path) => heard.push(path));

    f.controller.noteFolderChosen("Fotos");
    stop();
    f.controller.noteFolderChosen("Texte");

    expect(heard).toEqual(["Fotos"]);
  });

  it("answers null for a path that is not a folder, and leaves out a picture just deleted", async () => {
    const f = fixture({ present: ["Fotos", "Fotos/a.jpg", "Fotos/b.jpg", "Fotos/Notiz.md"] });
    expect(f.controller.folderTiles("Fotos/a.jpg")).toBeNull();
    expect(f.controller.folderTiles("Fehlt")).toBeNull();
    expect(f.controller.folderTiles("Fotos")?.images.map((image) => image.name)).toEqual([
      "a.jpg",
      "b.jpg"
    ]);

    // Trashed and not yet confirmed by the vault: gone from the grid at once,
    // as it is gone from the tree.
    f.present.add("Fotos/a.jpg");
    await deleteViaMenu(f.controller, new TFile("Fotos/a.jpg"));

    expect(f.controller.folderTiles("Fotos")?.images.map((image) => image.name)).toEqual(["b.jpg"]);
    expect(f.controller.folderHasImages("Fotos")).toBe(true);
    expect(f.controller.folderHasImages("Fotos/Notiz.md")).toBe(false);
  });
});

describe("the publication mark", () => {
  const account = {
    id: "grembl",
    name: "Grembl",
    folder: "Writings/Grembl",
    target: "writings",
    writeBack: true,
    headerTags: []
  };
  const note = new TFile("Writings/Grembl/Test.md");

  it("marks a note flagged in an account's folder", () => {
    const f = fixture({
      settings: { publishAccounts: [account] },
      frontmatter: { [note.path]: { published: true } }
    });
    expect(f.controller.publishMarkOf(note as never)).toMatchObject({
      state: "marked",
      account: "Grembl"
    });
  });

  it("marks nothing while no publishing account is set up", () => {
    const f = fixture({ frontmatter: { [note.path]: { published: true } } });
    expect(f.controller.publishMarkOf(note as never)).toEqual({ state: "none" });
  });

  it("marks no file that is not a note", () => {
    // Flagged all the same, so only the extension can be what refuses it.
    const f = fixture({
      settings: { publishAccounts: [account] },
      frontmatter: { "Writings/Grembl/Bild.png": { published: true } }
    });
    expect(f.controller.publishMarkOf(new TFile("Writings/Grembl/Bild.png") as never)).toEqual({
      state: "none"
    });
  });
});

describe("related notes", () => {
  it("lists a linked note with its reason, named by its file", () => {
    const f = fixture({
      present: ["A.md", "B.md", "C.md"],
      links: { "A.md": { "B.md": 1 } }
    });

    const [first] = f.controller.relatedCards("A.md");

    expect(first).toMatchObject({ path: "B.md", title: "B", folder: "" });
    expect(first?.reasons[0]).toEqual({ kind: "link", count: 1 });
  });

  it("matches tags regardless of case and hash", () => {
    const f = fixture({
      present: ["A.md", "B.md", "C.md"],
      tags: { "A.md": ["#Objekt"], "B.md": ["#objekt"], "C.md": ["#anderes"] }
    });

    const [first] = f.controller.relatedCards("A.md");

    expect(first?.path).toBe("B.md");
    expect(first?.reasons[0]).toEqual({ kind: "tag", count: 1 });
  });

  it("stops relating notes through a citer deleted a moment ago", async () => {
    const f = fixture({
      present: ["A.md", "B.md", "Liste.md"],
      links: { "Liste.md": { "A.md": 1, "B.md": 1 } }
    });
    const kinds = (): string[] =>
      f.controller
        .relatedCards("A.md")
        .find((card) => card.path === "B.md")
        ?.reasons.map((reason) => reason.kind) ?? [];
    expect(kinds()).toContain("co-citation");

    await deleteViaMenu(f.controller, new TFile("Liste.md"));

    expect(kinds()).not.toContain("co-citation");
  });

  it("names a note by its title, and nothing for a path the vault does not hold", () => {
    const f = fixture({ present: ["A.md"] });

    expect(f.controller.displayTitle("A.md")).toBe("A");
    expect(f.controller.displayTitle("Nirgends.md")).toBeNull();
  });
});

describe("a note that declines its task count", () => {
  it("keeps its tasks out of a pinned tag's sum, and is still listed under the tag", () => {
    const f = fixture({
      present: ["work.md", "reading.md"],
      tags: { "work.md": ["#projekt"], "reading.md": ["#projekt"] },
      listItems: {
        "work.md": [{ task: " " }, { task: "x" }],
        "reading.md": [{ task: " " }, { task: " " }, { task: " " }]
      },
      frontmatter: { "reading.md": { schreibstubeTaskCount: false } }
    });

    expect(f.controller.tagTallies(["projekt"]).get("projekt")).toEqual({ open: 1, total: 2 });
    const cards = f.controller.tagCards("projekt");
    expect(cards.map((card) => card.path).sort()).toEqual(["reading.md", "work.md"]);
    expect(cards.find((card) => card.path === "reading.md")?.tally).toEqual({ open: 0, total: 0 });
  });
});

describe("copying a spreadsheet as a table", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function csvFile(path: string, size = 100): TFile {
    return Object.assign(new TFile(path), { stat: { ctime: 1, mtime: 1, size } });
  }

  function clipboard(fails = false) {
    const writeText = vi.fn(async (_text: string) => {
      if (fails) throw new Error("denied");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    return writeText;
  }

  it("puts the table on the clipboard and says how large it is", async () => {
    const writeText = clipboard();
    const { controller } = fixture({
      contents: { "Daten/Kosten.csv": "Posten;Betrag\nMiete;850" }
    });

    await controller.run("copy-csv-table", csvFile("Daten/Kosten.csv") as never);

    expect(writeText).toHaveBeenCalledWith(
      "| Posten | Betrag |\n| ------ | -----: |\n| Miete  |    850 |"
    );
    expect(Notice.shown).toEqual([
      "Schreibstube: table with 1 row and 2 columns copied — paste it into any note."
    ]);
  });

  it("refuses a file too large to paste without reading it", async () => {
    const writeText = clipboard();
    const { controller } = fixture({ contents: {} });

    await controller.run("copy-csv-table", csvFile("big.csv", 2_000_000) as never);

    expect(writeText).not.toHaveBeenCalled();
    expect(Notice.shown[0]).toContain("larger than 1000 KB");
  });

  it("says why a file cannot be a table, and copies nothing", async () => {
    const writeText = clipboard();
    const { controller } = fixture({
      contents: { "empty.csv": "", "open.csv": '"a,b', "rows.csv": "h\n" + "x\n".repeat(2001) }
    });

    for (const path of ["empty.csv", "open.csv", "rows.csv", "missing.csv"]) {
      await controller.run("copy-csv-table", csvFile(path) as never);
    }

    expect(writeText).not.toHaveBeenCalled();
    expect(Notice.shown).toEqual([
      "Schreibstube: the file holds no rows.",
      "Schreibstube: a quote in the file is never closed, so its columns cannot be told apart.",
      "Schreibstube: the file has more than 2000 rows — too long to paste as a table.",
      "Schreibstube: the file could not be read."
    ]);
  });

  it("says so when the clipboard refuses", async () => {
    clipboard(true);
    const { controller } = fixture({ contents: { "a.csv": "a,b\n1,2" } });

    await controller.run("copy-csv-table", csvFile("a.csv") as never);

    expect(Notice.shown).toEqual(["Schreibstube: the clipboard is not available here."]);
  });

  it("leaves anything but a spreadsheet alone", async () => {
    const writeText = clipboard();
    const { controller } = fixture({ contents: { "a.md": "a,b\n1,2" } });

    await controller.run("copy-csv-table", csvFile("a.md") as never);

    expect(writeText).not.toHaveBeenCalled();
    expect(Notice.shown).toEqual([]);
  });
});
