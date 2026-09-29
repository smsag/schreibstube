// The engine's state machine against a fake vault and a fake model: the
// orderings the second review found wrong, each pinned by a test.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Platform, TFile, type Plugin } from "obsidian";
import type { SchreibstubeSettings } from "../../types";

const model = {
  failLoad: false,
  loads: 0,
  unloads: 0,
  disposed: 0,
  /** While set, every embed waits for it. */
  gate: null as Promise<void> | null,
  embeds: 0
};

vi.mock("./host/embedding-provider-factory", async () => {
  const { embeddingModelConfig } = await import("../../services/semantic/embedding-models");
  return {
    createEmbeddingProvider: (modelId: Parameters<typeof embeddingModelConfig>[0]) => {
      const dim = embeddingModelConfig(modelId).dim;
      let load: Promise<void> | null = null;
      let failed = false;
      let disposed = false;
      const provider = {
        dim,
        ready(): Promise<void> {
          if (disposed) return Promise.reject(new Error("disposed"));
          if (!load) {
            model.loads++;
            load = model.failLoad ? Promise.reject(new Error("load failed")) : Promise.resolve();
            load.catch(() => (failed = true));
          }
          return load;
        },
        async embed(texts: string[]): Promise<Float32Array[]> {
          await provider.ready();
          if (model.gate) await model.gate;
          model.embeds++;
          if (texts.some((t) => t.includes("BOOM"))) throw new Error("embed boom");
          return texts.map((t) => {
            const v = new Float32Array(dim);
            v[t.length % dim] = 1;
            v[0] = (v[0] ?? 0) + 0.5;
            return v;
          });
        },
        unload(): void {
          load = null;
          failed = false;
          model.unloads++;
        },
        dispose(): void {
          disposed = true;
          load = null;
          model.disposed++;
        },
        loadFailed: (): boolean => failed,
        isOffThread: (): boolean => true
      };
      return provider;
    }
  };
});
vi.mock("./host/worker-bundle-url", () => ({ embeddingWorkerUrl: async () => "worker.js" }));

import { SemanticEngine } from "./semantic-engine";
import { NULL_LOGGER } from "../../services/logger";

function world(notes: Record<string, string> = { "a.md": "alpha one", "b.md": "beta two" }) {
  const disk = new Map<string, ArrayBuffer>();
  const contents = new Map(Object.entries(notes));
  /** Readable, but not listed: an edit the build itself does not reach. */
  const unlisted = new Map<string, string>();
  const file = (path: string): TFile => {
    // The stub's constructor takes the path; Obsidian's own declares none.
    const f = new (TFile as unknown as new (path: string) => TFile)(path);
    f.stat = { ctime: 0, mtime: 1, size: 1 };
    return f;
  };
  const files = (): TFile[] => [...contents.keys()].map(file);
  const local = new Map<string, unknown>();
  /** Every file read, by path, and each file's modification time: the count
   *  of writes that reached it. */
  const reads: string[] = [];
  const mtimes = new Map<string, number>();
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: files,
      cachedRead: async (f: TFile) => contents.get(f.path) ?? unlisted.get(f.path) ?? "",
      adapter: {
        exists: async (p: string) => disk.has(p) || p === ".obsidian/plugins/s",
        readBinary: async (p: string) => {
          reads.push(p);
          return disk.get(p) ?? new ArrayBuffer(0);
        },
        writeBinary: async (p: string, b: ArrayBuffer) => void disk.set(p, b),
        rename: async (from: string, to: string) => {
          disk.set(to, disk.get(from)!);
          disk.delete(from);
          mtimes.set(to, (mtimes.get(to) ?? 0) + 1);
        },
        remove: async (p: string) => void disk.delete(p),
        mkdir: async () => undefined,
        stat: async (p: string) =>
          disk.has(p) ? { size: disk.get(p)!.byteLength, mtime: mtimes.get(p) ?? 1 } : null
      },
      on: () => ({})
    },
    metadataCache: { getFileCache: () => ({}) },
    workspace: { onLayoutReady: () => undefined, getActiveFile: () => null, on: () => ({}) },
    loadLocalStorage: (k: string) => local.get(k),
    saveLocalStorage: (k: string, v: unknown) => void local.set(k, v),
    plugins: { enabledPlugins: new Set<string>() }
  };
  const plugin = {
    app,
    manifest: { id: "s", dir: ".obsidian/plugins/s" },
    register: () => undefined,
    registerEvent: () => undefined,
    registerDomEvent: () => undefined,
    registerInterval: () => 0
  } as unknown as Plugin;
  const settings = {
    semanticSearchEnabled: true,
    semanticMaxNotes: 1000,
    semanticSources: {}
  } as unknown as SchreibstubeSettings;
  const engine = (): SemanticEngine => new SemanticEngine(plugin, () => settings, NULL_LOGGER, 5);
  return { plugin, settings, contents, unlisted, disk, reads, file, engine };
}

type Internals = {
  syncing: boolean;
  phase: { kind: string; loadFailed?: boolean };
  lastBuild: { stopped: boolean; error: string | null; kind: string } | null;
  catchUp(): Promise<void>;
};
const inside = (e: SemanticEngine): Internals => e as unknown as Internals;
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 2));
};
const built = async (e: SemanticEngine): Promise<void> => {
  await e.search("alpha", 5);
  await until(() => e.searchState() === "ready" && !inside(e).syncing);
};

beforeEach(() => {
  Object.assign(model, {
    failLoad: false,
    loads: 0,
    unloads: 0,
    disposed: 0,
    gate: null,
    embeds: 0
  });
});

describe("SemanticEngine", () => {
  it("answers from a finished index that the panel or the settings read first", async () => {
    const w = world();
    await built(w.engine());

    const panelFirst = w.engine();
    await panelFirst.relatedToNote("a.md", 5);
    expect((await panelFirst.search("alpha one", 5)).length).toBeGreaterThan(0);

    const settingsFirst = w.engine();
    await settingsFirst.report();
    expect((await settingsFirst.search("alpha one", 5)).length).toBeGreaterThan(0);
  });

  it("reads a finished index before asking for a build, so a search does not rebuild it", async () => {
    const w = world();
    await built(w.engine());
    const e = w.engine();
    expect((await e.search("alpha one", 5)).length).toBeGreaterThan(0);
    await until(() => !inside(e).syncing);
    expect(await e.report()).toMatchObject({ build: null });
    expect(e.searchState()).toBe("ready");
  });

  it("does not report a build as failed because an edit held for it failed", async () => {
    const w = world();
    const e = w.engine();
    w.unlisted.set("c.md", "BOOM note");
    await e.applyChanges([w.file("c.md")], []); // held: the index is not read yet
    await built(e);
    expect(inside(e).phase.kind).toBe("idle");
    await expect(e.applyChanges([w.file("c.md")], [])).resolves.toBeUndefined();
  });

  it("marks itself busy at once when the catch-up starts", async () => {
    const w = world();
    await built(w.engine());
    const e = w.engine();
    const run = inside(e).catchUp();
    expect(inside(e).syncing).toBe(true);
    await run;
  });

  it("loads the model afresh on the first Build now after a load failed elsewhere", async () => {
    const w = world();
    await built(w.engine());
    w.contents.set("a.md", "alpha changed");
    model.failLoad = true;
    const e = w.engine();
    await inside(e).catchUp();
    model.failLoad = false;
    const loads = model.loads;
    e.buildNow();
    await until(() => !inside(e).syncing);
    expect(model.loads).toBeGreaterThan(loads);
    expect(inside(e).phase.kind).toBe("idle");
  });

  it("lets a settings change end the pause a failure put on automatic builds", async () => {
    const w = world();
    const e = w.engine();
    model.failLoad = true;
    await e.search("alpha", 5);
    await until(() => inside(e).phase.kind === "failed");
    e.settingsChanged();
    expect(inside(e).phase.kind).toBe("idle");
  });

  it("says a search waits on the person once a build failed, and not while one runs", async () => {
    const w = world();
    const e = w.engine();
    expect(e.waitsOnPerson()).toBe(false);
    model.failLoad = true;
    await e.search("alpha", 5);
    await until(() => inside(e).phase.kind === "failed");
    expect(e.waitsOnPerson()).toBe(true);
    model.failLoad = false;
    e.buildNow();
    expect(e.waitsOnPerson()).toBe(false);
    await until(() => !inside(e).syncing);
    expect(e.waitsOnPerson()).toBe(false);
  });

  it("says a search waits on the person while automatic builds are paused", async () => {
    const w = world();
    w.plugin.app.saveLocalStorage("schreibstube-semantic-index-build", {
      attempts: 2,
      startedAt: 1,
      modelId: "x"
    });
    const e = w.engine();
    expect(e.waitsOnPerson()).toBe(false); // not read yet: the first search reads it
    await e.status();
    expect(e.waitsOnPerson()).toBe(true);
  });

  it("gives the model back when switched off during a build", async () => {
    const w = world();
    const e = w.engine();
    let open: () => void = () => undefined;
    model.gate = new Promise<void>((r) => (open = r));
    void e.search("alpha", 5);
    await until(() => inside(e).syncing && model.loads > 0);
    w.settings.semanticSearchEnabled = false;
    e.settingsChanged();
    const unloads = model.unloads;
    model.gate = null;
    open();
    await until(() => !inside(e).syncing);
    expect(model.unloads).toBeGreaterThan(unloads);
  });

  it("warms up on focus: reads a finished index and loads the model before the first search", async () => {
    const w = world();
    await built(w.engine());
    const e = w.engine();
    const loads = model.loads;
    e.warm();
    await until(() => e.searchState() === "ready" && model.loads > loads);
    expect(e.searchState()).toBe("ready");
    expect(model.loads).toBe(loads + 1);

    await e.search("alpha one", 5);
    const report = await e.report();
    expect(report?.search?.loadMs).toBe(0); // the warm-up had already loaded it
    expect(report?.search?.notes).toBe(2);
  });

  it("does not warm up a model nobody has used on this vault", async () => {
    const w = world();
    const e = w.engine();
    e.warm();
    await new Promise((r) => setTimeout(r, 20));
    expect(model.loads).toBe(0);
    expect(inside(e).syncing).toBe(false);
  });

  it("reports the status from the index it holds, reading the file once", async () => {
    const w = world();
    await built(w.engine());
    const e = w.engine();
    expect(await e.status()).toMatchObject({ state: "ready", count: 2 });
    const reads = w.reads.length;
    expect(await e.status()).toMatchObject({ state: "ready", count: 2 });
    expect(w.reads.length).toBe(reads);
  });

  it("says a finished index is ready even while automatic builds are paused", async () => {
    const w = world();
    await built(w.engine());
    w.plugin.app.saveLocalStorage("schreibstube-semantic-index-build", {
      attempts: 2,
      startedAt: 1,
      modelId: "x"
    });
    const e = w.engine();
    expect((await e.status()).state).toBe("ready");
    w.contents.set("c.md", "gamma");
    w.settings.semanticMaxNotes = 1; // another scope: no longer complete under it
    expect((await w.engine().status()).state).toBe("paused");
  });

  it("takes an unload during a build as a stop, not a failure", async () => {
    const w = world(
      Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`n${i}.md`, `alpha ${i}`]))
    );
    const e = w.engine();
    let open: () => void = () => undefined;
    model.gate = new Promise<void>((r) => (open = r));
    void e.search("alpha", 5);
    await until(() => inside(e).syncing && model.loads > 0);
    e.dispose();
    model.gate = null;
    open();
    await until(() => !inside(e).syncing);
    expect(inside(e).phase.kind).toBe("idle");
    expect(inside(e).lastBuild).toMatchObject({ stopped: true, error: null });
  });

  it("takes an unload during the catch-up as a stop, not a failure", async () => {
    const w = world();
    await built(w.engine());
    w.contents.set("a.md", "alpha changed");
    const e = w.engine();
    let open: () => void = () => undefined;
    model.gate = new Promise<void>((r) => (open = r));
    const run = inside(e).catchUp();
    await until(() => model.loads > 0);
    e.dispose();
    model.gate = null;
    open();
    await run;
    expect(inside(e).phase.kind).toBe("idle");
    expect(inside(e).lastBuild?.error ?? null).toBeNull();
  });

  it("stops a running build at unload and does not load the model again", async () => {
    const w = world(
      Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`n${i}.md`, `alpha ${i}`]))
    );
    const e = w.engine();
    let open: () => void = () => undefined;
    model.gate = new Promise<void>((r) => (open = r));
    void e.search("alpha", 5);
    await until(() => inside(e).syncing && model.loads > 0);
    e.dispose();
    model.gate = null;
    open();
    await until(() => !inside(e).syncing);
    expect(model.disposed).toBe(1);
    expect(model.embeds).toBeLessThanOrEqual(1);
  });
});

describe("a phone holding the desktop's index", () => {
  const platform = Platform as { isMobile?: boolean };
  afterEach(() => {
    delete platform.isMobile;
  });

  it("says a search waits on the person until the desktop has written an index", async () => {
    const w = world();
    platform.isMobile = true;
    const phone = w.engine();
    await phone.status();
    expect(phone.waitsOnPerson()).toBe(true);
  });

  it("reads the file again only when the desktop has written a new one", async () => {
    const w = world();
    await built(w.engine());
    platform.isMobile = true;
    const phone = w.engine();
    const look = async (): Promise<void> => {
      phone.warm(); // the phone's look at the desktop's file
      await until(() => inside(phone).syncing);
      await until(() => !inside(phone).syncing);
    };
    await look();
    expect(phone.searchState()).toBe("ready");
    expect(phone.waitsOnPerson()).toBe(false);
    let reads = w.reads.length;

    await look(); // the same file: not read again
    expect(w.reads.length).toBe(reads);

    // The desktop wrote more: read once more.
    platform.isMobile = false;
    w.contents.set("c.md", "gamma three");
    const desktop = w.engine();
    desktop.buildNow();
    await until(() => !inside(desktop).syncing);
    platform.isMobile = true;
    reads = w.reads.length;
    await look();
    expect(w.reads.length).toBeGreaterThan(reads);
    expect((await phone.report())?.indexed).toBe(3);
  });
});

describe("what a search can find", () => {
  it("is announced when it changed, once for a burst, and not for a status change alone", async () => {
    const w = world();
    const e = w.engine();
    const changed = vi.fn();
    e.onContentChange(changed);
    await built(e);
    await until(() => changed.mock.calls.length > 0);
    await new Promise((r) => setTimeout(r, 20));
    expect(changed).toHaveBeenCalledTimes(1);

    // A settings change emits, and moves nothing a search can find.
    e.settingsChanged();
    await new Promise((r) => setTimeout(r, 20));
    expect(changed).toHaveBeenCalledTimes(1);

    w.contents.set("a.md", "alpha one, changed");
    await e.applyChanges([w.file("a.md")], []);
    await until(() => changed.mock.calls.length > 1);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe("a source's item", () => {
  // The source's list deadline sets a timer on `window`, which a node test lacks.
  beforeEach(() => vi.stubGlobal("window", globalThis));
  afterEach(() => vi.unstubAllGlobals());

  const source = (items: { id: string; text: string }[]) => ({
    kind: "conversation",
    label: "Conversation",
    plural: "Conversations",
    list: () => items.map((i) => ({ id: i.id, title: "", updatedAt: 1, messages: [i.text] })),
    onChanged: () => () => undefined
  });

  it("finds the notes and items like it, itself left out, at the floors measured for each", async () => {
    const w = world();
    (w.settings as { semanticSources: Record<string, boolean> }).semanticSources = { pythia: true };
    const e = w.engine();
    await built(e);
    const { readSource, itemKey } = await import("../../services/semantic/semantic-api");
    const read = readSource(
      source([
        { id: "c1", text: "alpha one" },
        { id: "c2", text: "gamma two" }
      ]),
      () => true
    );
    if (!("source" in read)) throw new Error(read.problem);
    e.sources.register("pythia", read.source, read.descriptor);
    await e.findItems("alpha one", 5); // the source is listed and embedded

    const found = await e.relatedToItem(itemKey("pythia", "c1"), 5);
    expect(found.notes.map((n) => n.id)).toContain("a.md");
    expect(found.items.map((i) => i.key)).not.toContain(itemKey("pythia", "c1"));
    const { embeddingModelConfig } = await import("../../services/semantic/embedding-models");
    const floors = embeddingModelConfig(e.modelId());
    expect(found.notesFloor).toBe(floors.conversationFloors.balanced);
    expect(found.itemsFloor).toBe(floors.relatedFloors.balanced);
  });

  it("leaves the vault index unread when only related items are wanted", async () => {
    const w = world();
    (w.settings as { semanticSources: Record<string, boolean> }).semanticSources = { pythia: true };
    const e = w.engine();
    const { readSource, itemKey } = await import("../../services/semantic/semantic-api");
    const read = readSource(
      source([
        { id: "c1", text: "alpha one" },
        { id: "c2", text: "gamma two" }
      ]),
      () => true
    );
    if (!("source" in read)) throw new Error(read.problem);
    e.sources.register("pythia", read.source, read.descriptor);
    await e.findItems("alpha one", 5);
    w.reads.length = 0;
    const found = await e.relatedToItem(itemKey("pythia", "c1"), 5, {
      notes: false,
      items: true,
      sources: null
    });
    expect(found.notes).toEqual([]);
    expect(found.items.map((i) => i.key)).toContain(itemKey("pythia", "c2"));
    expect(w.reads.filter((p) => !p.includes("semantic-source-"))).toEqual([]);
  });

  it("reads items against the floor the query's own length decides, as notes are", async () => {
    const w = world();
    const e = w.engine();
    const { meaningFloor } = await import("../../services/semantic/search-fusion");
    const opts = { notes: 0, items: 5, exclude: new Set<string>(), sources: null };
    const word = await e.searchAll("alpha", opts);
    const phrase = await e.searchAll("alpha one and beta two", opts);
    expect(word.itemsFloor).toBe(meaningFloor("alpha").minScore);
    expect(word.itemsFloor).toBe(word.notesFloor);
    expect(phrase.itemsFloor).toBe(meaningFloor("alpha one and beta two").minScore);
  });

  it("asks about a source only once search by meaning is on", async () => {
    const w = world();
    w.settings.semanticSearchEnabled = false;
    const e = w.engine();
    const asked = vi.fn();
    e.onConsentNeeded(asked);
    const { readSource } = await import("../../services/semantic/semantic-api");
    const read = readSource(source([]), () => true);
    if (!("source" in read)) throw new Error(read.problem);
    e.sources.register("stranger", read.source, read.descriptor);
    expect(asked).not.toHaveBeenCalled();
    w.settings.semanticSearchEnabled = true;
    e.settingsChanged();
    expect(asked).toHaveBeenCalledWith("stranger", read.descriptor);
  });

  it("is never asked about while the person has not allowed its source", async () => {
    const w = world();
    const e = w.engine();
    const asked = vi.fn();
    e.onConsentNeeded(asked);
    const list = vi.fn(() => []);
    const { readSource } = await import("../../services/semantic/semantic-api");
    const read = readSource({ ...source([]), list }, () => true);
    if (!("source" in read)) throw new Error(read.problem);
    e.sources.register("stranger", read.source, read.descriptor);
    expect(asked).toHaveBeenCalledWith("stranger", read.descriptor);
    await e.findItems("alpha", 5);
    expect(list).not.toHaveBeenCalled();
  });
});
