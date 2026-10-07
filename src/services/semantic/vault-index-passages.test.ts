// The passage hashes a vault row carries, so a later version of the note can
// find which stored vectors are the passages around a place in it.
import { describe, expect, it } from "vitest";
import { VaultIndexService, type IndexableNote } from "./vault-index-service";
import type { IndexStore } from "./index-store";
import type { EmbeddingProvider } from "./embedding-provider";
import { deserializeIndex, passageHashes, serializeIndex } from "./embedding-index";
import { vaultNoteChunks } from "./vault-retrieval";

class FakeProvider implements EmbeddingProvider {
  readonly dim = 4;
  embedded = 0;
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.embedded += texts.length;
    return texts.map(() => Float32Array.from([1, 0, 0, 0]));
  }
  unload(): void {}
}

class MemStore implements IndexStore {
  buf: ArrayBuffer | null = null;
  writes = 0;
  private journalStore: MemStore | null = null;
  async read(): Promise<ArrayBuffer | null> {
    return this.buf;
  }
  async write(b: ArrayBuffer): Promise<void> {
    this.buf = b;
    this.writes++;
  }
  journal(): IndexStore {
    return (this.journalStore ??= new MemStore());
  }
}

const TEXT = "## One\nthe first part\n## Two\nthe second part";
const note = (path: string, content: string): IndexableNote => ({
  path,
  load: async () => content
});
const hashesOf = (content: string): number[] =>
  Array.from(passageHashes(vaultNoteChunks(content, 20)));

describe("a vault row's passage hashes", () => {
  it("are written with the vectors a note is embedded as", async () => {
    const store = new MemStore();
    const svc = new VaultIndexService(new FakeProvider(), store, { maxChars: 20 });
    await svc.sync([note("a.md", TEXT)], undefined, {}, "s");
    const source = svc.sourceOf("a.md");
    expect(source?.chunks.length).toBeGreaterThan(1);
    expect(Array.from(source?.passages ?? [])).toEqual(hashesOf(TEXT));
    expect(svc.sourceOf("missing.md")).toBeNull();
  });

  it("are given to an unchanged row written without them, in one write and with no embed", async () => {
    const store = new MemStore();
    await new VaultIndexService(new FakeProvider(), store, { maxChars: 20 }).sync(
      [note("a.md", TEXT)],
      undefined,
      {},
      "s"
    );
    // The same file as a release before passage hashes would have written it.
    const { items, dim, meta } = deserializeIndex(store.buf ?? new ArrayBuffer(0));
    store.buf = serializeIndex(
      items.map(({ passages: _dropped, ...row }) => row),
      dim,
      meta
    );
    store.writes = 0;

    const provider = new FakeProvider();
    const svc = new VaultIndexService(provider, store, { maxChars: 20 });
    await svc.sync([note("a.md", TEXT)], undefined, {}, "s");
    expect(provider.embedded).toBe(0);
    expect(store.writes).toBe(1);
    expect(Array.from(svc.sourceOf("a.md")?.passages ?? [])).toEqual(hashesOf(TEXT));

    // Once given, the next sync has nothing to write.
    await new VaultIndexService(new FakeProvider(), store, { maxChars: 20 }).sync(
      [note("a.md", TEXT)],
      undefined,
      {},
      "s"
    );
    expect(store.writes).toBe(1);
  });

  it("follow an edit of the note", async () => {
    const store = new MemStore();
    const svc = new VaultIndexService(new FakeProvider(), store, { maxChars: 20 });
    await svc.sync([note("a.md", TEXT)], undefined, {}, "s");
    const edited = `${TEXT}\n## Three\nthe third part`;
    await svc.updateNote(note("a.md", edited));
    expect(Array.from(svc.sourceOf("a.md")?.passages ?? [])).toEqual(hashesOf(edited));
  });
});
