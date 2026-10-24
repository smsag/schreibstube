// The list Nimbus reads, wired to a fake vault: who writes it, when, and when
// it is left alone or removed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type Plugin } from "obsidian";
import {
  localDeviceId,
  RelatedExportWriter,
  type RelatedExportHost,
  type RelatedSnapshot
} from "./related-export";
import { quantize } from "../../services/semantic/vector-math";
import { passageHashes } from "../../services/semantic/embedding-index";
import { vaultNoteChunks } from "../../services/semantic/vault-retrieval";
import {
  RELATED_CLAIM_MS,
  readRelatedFile,
  readWriterClaim,
  serializeWriterClaim
} from "../../services/semantic/related-export";
import { NULL_LOGGER } from "../../services/logger";

const PATH = ".obsidian/plugins/schreibstube/nimbus-related.json";
const CLAIM = ".obsidian/plugins/schreibstube/nimbus-related.writer.json";
const ME = "desktop-this-0001";
const OTHER = "desktop-other-0002";
const FILLER = "mit genug Worten darin damit es Substanz hat und nicht nur Rauschen ist";

function vectorFor(text: string): Int8Array {
  return quantize(Float32Array.from([text.includes("KISTEN") ? 1 : 0, 0.1, 0]));
}

function world(device: "desktop" | "mobile" = "desktop") {
  const notes = new Map<string, { content: string; frontmatter: Record<string, unknown> }>([
    ["Umzug.md", { content: `KISTEN packen ${FILLER}`, frontmatter: { nimbusProject: "umzug" } }],
    ["Kisten.md", { content: `KISTEN zählen ${FILLER}`, frontmatter: {} }]
  ]);
  const disk = new Map<string, string>();
  /** Writes of the list itself; the claim's are counted apart. */
  const writes: string[] = [];
  const claims: string[] = [];
  const handlers: ((file: TFile, data: string, cache: { frontmatter?: unknown }) => void)[] = [];
  const layout: (() => void)[] = [];
  const file = (path: string): TFile => {
    const f = new (TFile as unknown as new (path: string) => TFile)(path);
    f.stat = { ctime: 0, mtime: Date.UTC(2026, 9, 12), size: 1 };
    return f;
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [...notes.keys()].map(file),
      getAbstractFileByPath: (p: string) => (notes.has(p) ? file(p) : null),
      cachedRead: async (f: TFile) => notes.get(f.path)?.content ?? "",
      adapter: {
        exists: async (p: string) => disk.has(p),
        stat: async (p: string) => (disk.has(p) ? { size: disk.get(p)!.length, mtime: 1 } : null),
        read: async (p: string) => disk.get(p) ?? "",
        write: async (p: string, text: string) => {
          (p === CLAIM ? claims : writes).push(p);
          disk.set(p, text);
        },
        remove: async (p: string) => void disk.delete(p),
        mkdir: async (p: string) => void disk.set(p, "")
      }
    },
    metadataCache: {
      getFileCache: (f: TFile) => ({ frontmatter: notes.get(f.path)?.frontmatter, tags: [] }),
      on: (_name: string, handler: (typeof handlers)[number]) => {
        handlers.push(handler);
        return {};
      }
    },
    workspace: { onLayoutReady: (cb: () => void) => void layout.push(cb) }
  };
  const plugin = {
    app,
    manifest: { id: "schreibstube", dir: ".obsidian/plugins/schreibstube" },
    registerEvent: () => undefined
  } as unknown as Plugin;
  const rows = (): RelatedSnapshot["rows"] =>
    [...notes].map(([id, n]) => {
      const chunks = vaultNoteChunks(n.content, 500);
      return { id, chunks: chunks.map(vectorFor), passages: passageHashes(chunks) };
    });
  const content = new Set<() => void>();
  const state = { on: true, ready: true, revision: 0, device: ME };
  const host: RelatedExportHost = {
    device,
    switchedOn: () => state.on,
    snapshot: () => (state.ready ? { rows: rows(), model: "m", floor: 0.65, maxChars: 500 } : null),
    onContentChange: (listener) => {
      content.add(listener);
      return () => content.delete(listener);
    },
    vaultRevision: () => state.revision,
    deviceId: () => state.device
  };
  let clock = 0;
  const writer = new RelatedExportWriter(plugin, host, NULL_LOGGER, {
    debounceMs: 1_000,
    intervalMs: 10_000,
    retryMs: 3_000,
    now: () => clock
  });
  return {
    writer,
    notes,
    disk,
    writes,
    claims,
    state,
    now: () => clock,
    layoutReady: () => layout.forEach((cb) => cb()),
    /** A row of the vault index moved. */
    contentChanged: () => {
      state.revision++;
      content.forEach((cb) => cb());
    },
    /** A source synced: the content event moves, the vault index does not. */
    sourceChanged: () => content.forEach((cb) => cb()),
    metadataChanged: (path: string, frontmatter: unknown) =>
      handlers.forEach((h) => h(file(path), "", { frontmatter })),
    advance: async (ms: number) => {
      clock += ms;
      await vi.advanceTimersByTimeAsync(ms);
    },
    listeners: () => content.size
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RelatedExportWriter", () => {
  it("writes the list a reader accepts once the vault is quiet", async () => {
    const w = world();
    w.writer.start();
    w.layoutReady();
    await w.advance(500);
    expect(w.writes).toEqual([]);
    await w.advance(600);
    expect(w.writes).toEqual([PATH]);
    const read = readRelatedFile(w.disk.get(PATH) ?? "");
    expect(read.ok && read.file.projects[0]?.related.map((r) => r.path)).toEqual(["Kisten.md"]);
  });

  it("writes nothing when only writtenAt would change, and again when the list did", async () => {
    const w = world();
    w.writer.start();
    await w.writer.run();
    expect(w.writes).toHaveLength(1);
    await w.advance(20_000);
    await w.writer.run();
    expect(w.writes).toHaveLength(1);
    w.notes.set("Mehr.md", { content: `KISTEN mehr ${FILLER}`, frontmatter: {} });
    await w.writer.run();
    expect(w.writes).toHaveLength(2);
  });

  it("runs at most once in the interval, however often the index changes", async () => {
    const w = world();
    w.writer.start();
    w.contentChanged();
    await w.advance(1_100);
    expect(w.writes).toHaveLength(1);
    w.notes.set("Mehr.md", { content: `KISTEN mehr ${FILLER}`, frontmatter: {} });
    w.contentChanged();
    await w.advance(1_100);
    expect(w.writes).toHaveLength(1);
    await w.advance(9_000);
    expect(w.writes).toHaveLength(2);
  });

  it("follows a project note's frontmatter, and the key taken out of one", async () => {
    const w = world();
    w.writer.start();
    w.metadataChanged("Anders.md", {});
    await w.advance(1_100);
    expect(w.writes).toEqual([]);
    w.metadataChanged("Umzug.md", { nimbusProject: "umzug" });
    await w.advance(1_100);
    expect(w.writes).toHaveLength(1);
    w.notes.set("Umzug.md", { content: `KISTEN packen ${FILLER}`, frontmatter: {} });
    w.metadataChanged("Umzug.md", {});
    await w.advance(10_000);
    expect(w.writes).toHaveLength(2);
    const read = readRelatedFile(w.disk.get(PATH) ?? "");
    expect(read.ok && read.file.projects).toEqual([]);
  });

  it("waits for an index that is being built", async () => {
    const w = world();
    w.state.ready = false;
    w.writer.start();
    w.contentChanged();
    await w.advance(1_100);
    expect(w.writes).toEqual([]);
    w.state.ready = true;
    await w.advance(3_000);
    expect(w.writes).toHaveLength(1);
  });

  it("removes the file when search by meaning is switched off, and writes none", async () => {
    const w = world();
    w.writer.start();
    await w.writer.run();
    expect(w.disk.has(PATH)).toBe(true);
    w.state.on = false;
    w.writer.settingsChanged();
    await w.advance(0);
    expect(w.disk.has(PATH)).toBe(false);
    await w.writer.run();
    expect(w.disk.has(PATH)).toBe(false);
  });

  it("removes a file left behind when it starts switched off", async () => {
    const w = world();
    w.disk.set(PATH, "{}");
    w.state.on = false;
    w.writer.start();
    w.layoutReady();
    await w.advance(0);
    expect(w.disk.has(PATH)).toBe(false);
  });

  it("never writes or removes the file on a phone", async () => {
    const w = world("mobile");
    w.disk.set(PATH, "{}");
    w.writer.start();
    w.layoutReady();
    w.contentChanged();
    await w.writer.run();
    w.state.on = false;
    w.writer.settingsChanged();
    await w.advance(20_000);
    expect(w.writes).toEqual([]);
    expect(w.disk.get(PATH)).toBe("{}");
    expect(w.listeners()).toBe(0);
  });

  it("stops at dispose", async () => {
    const w = world();
    w.writer.start();
    w.contentChanged();
    w.writer.dispose();
    await w.advance(20_000);
    expect(w.writes).toEqual([]);
    expect(w.listeners()).toBe(0);
  });

  it("builds nothing when only a source synced, since the list is not made from it", async () => {
    const w = world();
    w.writer.start();
    w.contentChanged();
    await w.advance(1_100);
    expect(w.writes).toHaveLength(1);
    w.notes.set("Mehr.md", { content: `KISTEN mehr ${FILLER}`, frontmatter: {} });
    w.sourceChanged();
    await w.advance(20_000);
    expect(w.writes).toHaveLength(1);
    w.contentChanged();
    await w.advance(20_000);
    expect(w.writes).toHaveLength(2);
  });

  it("claims the list for this desktop when nobody holds it", async () => {
    const w = world();
    w.writer.start();
    await w.writer.run();
    expect(w.writes).toEqual([PATH]);
    expect(readWriterClaim(w.disk.get(CLAIM) ?? null)?.device).toBe(ME);
  });

  it("leaves the list to the desktop that holds it, and takes it once that claim is old", async () => {
    const w = world();
    w.disk.set(CLAIM, serializeWriterClaim({ device: OTHER, at: w.now() }));
    w.writer.start();
    await w.writer.run();
    expect(w.writes).toEqual([]);
    expect(w.claims).toEqual([]);

    w.disk.set(CLAIM, serializeWriterClaim({ device: OTHER, at: w.now() - RELATED_CLAIM_MS }));
    await w.advance(20_000);
    await w.writer.run();
    expect(w.writes).toEqual([PATH]);
    expect(readWriterClaim(w.disk.get(CLAIM) ?? null)?.device).toBe(ME);
  });

  it("deletes the list when switched off only where it holds it, and lets the claim go", async () => {
    const theirs = world();
    theirs.disk.set(PATH, "{}");
    theirs.disk.set(CLAIM, serializeWriterClaim({ device: OTHER, at: theirs.now() }));
    theirs.state.on = false;
    theirs.writer.start();
    theirs.writer.settingsChanged();
    await theirs.advance(0);
    expect(theirs.disk.get(PATH)).toBe("{}");

    const mine = world();
    mine.writer.start();
    await mine.writer.run();
    mine.state.on = false;
    mine.writer.settingsChanged();
    await mine.advance(0);
    expect(mine.disk.has(PATH)).toBe(false);
    expect(mine.disk.has(CLAIM)).toBe(false);
  });

  it("keeps one id for this device, in its own storage, and the same one without it", () => {
    const stored = new Map<string, unknown>();
    const app = {
      loadLocalStorage: (key: string) => stored.get(key) ?? null,
      saveLocalStorage: (key: string, value: unknown) => void stored.set(key, value)
    };
    const id = localDeviceId(app);
    expect(id).toMatch(/^[a-z0-9-]{8,64}$/);
    expect(localDeviceId(app)).toBe(id);
    expect(localDeviceId({})).toBe(localDeviceId({}));
  });

  it("writes over a file a reader would refuse", async () => {
    const w = world();
    w.disk.set(PATH, "x".repeat(2 * 1024 * 1024 + 1));
    w.writer.start();
    await w.writer.run();
    expect(readRelatedFile(w.disk.get(PATH) ?? "").ok).toBe(true);
  });
});
