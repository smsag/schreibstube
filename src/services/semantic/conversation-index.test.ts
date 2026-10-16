import { describe, expect, it, vi } from "vitest";
import { ConversationIndex } from "./conversation-index";
import { conversationChunks, type ConversationItem } from "./conversation-source";
import { conversationContentHash, serializeIndex } from "./embedding-index";
import type { EmbeddingProvider } from "./embedding-provider";
import type { IndexStore } from "./index-store";
import { hashPolicyFor } from "./row-provenance";
import { MAX_SOURCE_CHUNKS, quantize } from "./vector-math";

/** Maps text to an axis by keyword, and records what it embedded. */
class FakeProvider implements EmbeddingProvider {
  readonly dim = 4;
  embedded: string[] = [];
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.embedded.push(...texts);
    return texts.map((t) => {
      const v = new Float32Array(4);
      if (t.includes("küche")) v[0] = 1;
      else if (t.includes("garten")) v[1] = 1;
      else v[2] = 1;
      return v;
    });
  }
  unload(): void {}
}

class MemStore implements IndexStore {
  buf: ArrayBuffer | null = null;
  writes = 0;
  async read(): Promise<ArrayBuffer | null> {
    return this.buf;
  }
  async write(b: ArrayBuffer): Promise<void> {
    this.buf = b;
    this.writes++;
  }
}

const conv = (id: string, text: string, title = ""): ConversationItem => ({
  id,
  title,
  updatedAt: 1,
  summary: "",
  messages: [text],
  notes: []
});
const POLICY = hashPolicyFor("xenova-paraphrase-multilingual-MiniLM-L12-v2");
const OPTS = { minScore: 0.5, limit: 10 };

describe("ConversationIndex", () => {
  it("reads the stored index once for searches that arrive together, and they wait for it", async () => {
    const store = new MemStore();
    await new ConversationIndex(new FakeProvider(), store, POLICY).sync([conv("a", "küche")]);
    const read = vi.spyOn(store, "read");
    const index = new ConversationIndex(new FakeProvider(), store, POLICY);

    const [, , found] = await Promise.all([
      index.loadStored(),
      index.loadStored(),
      index.query("küche", OPTS)
    ]);

    expect(read).toHaveBeenCalledTimes(1);
    expect(found.map((r) => r.id)).toEqual(["a"]);
  });

  it("tries a failed read once more, so one transient error fails no waiter", async () => {
    const store = new MemStore();
    await new ConversationIndex(new FakeProvider(), store, POLICY).sync([conv("a", "küche")]);
    const read = vi.spyOn(store, "read").mockRejectedValueOnce(new Error("EBUSY"));
    const warn = vi.fn();
    const index = new ConversationIndex(new FakeProvider(), store, POLICY, warn);

    await Promise.all([index.loadStored(), index.loadStored()]);

    expect(read).toHaveBeenCalledTimes(2);
    expect(index.size()).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("trying once more"),
      expect.any(Error)
    );
  });

  it("rejects a read that failed twice, and the next caller reads again", async () => {
    const store = new MemStore();
    const read = vi
      .spyOn(store, "read")
      .mockRejectedValueOnce(new Error("disk"))
      .mockRejectedValueOnce(new Error("disk"));
    const index = new ConversationIndex(new FakeProvider(), store, POLICY);

    await expect(index.loadStored()).rejects.toThrow("disk");
    await index.loadStored();

    expect(read).toHaveBeenCalledTimes(3);
  });

  it("gives up a read that never answers, instead of holding every search", async () => {
    const store = new MemStore();
    vi.spyOn(store, "read").mockReturnValue(new Promise(() => {}));
    const index = new ConversationIndex(new FakeProvider(), store, POLICY, () => undefined, 20);

    await expect(index.loadStored()).rejects.toThrow("not read within");
    expect(index.reading()).toBeNull();
  });

  it("says when the stored index cannot be decoded, and reads it as empty", async () => {
    const store = new MemStore();
    store.buf = new Uint8Array([1, 2, 3]).buffer;
    const warn = vi.fn();
    const index = new ConversationIndex(new FakeProvider(), store, POLICY, warn);

    await index.loadStored();

    expect(index.size()).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be decoded"),
      expect.anything()
    );
  });

  it("reads again once another device replaced the file, not after its own write", async () => {
    const store = new MemStore() as MemStore & { mtime(): Promise<number | null> };
    let mtime = 1;
    store.mtime = async () => mtime;
    const desktop = new ConversationIndex(new FakeProvider(), new MemStore(), POLICY);
    await desktop.sync([conv("a", "küche")]);
    store.buf = (desktop as unknown as { store: MemStore }).store.buf;
    const phone = new ConversationIndex(new FakeProvider(), store, POLICY);
    await phone.loadStored();
    expect(phone.size()).toBe(1);

    await desktop.sync([conv("a", "küche"), conv("b", "garten")]);
    store.buf = (desktop as unknown as { store: MemStore }).store.buf;
    const read = vi.spyOn(store, "read");
    await phone.loadStored();
    expect(read).not.toHaveBeenCalled(); // unchanged on disk: no read

    mtime = 2;
    await phone.loadStored();
    expect(read).toHaveBeenCalledTimes(1);
    expect(phone.size()).toBe(2);
  });

  it("does not read its own write back as another device's", async () => {
    const store = new MemStore() as MemStore & { mtime(): Promise<number | null> };
    let mtime = 1;
    store.mtime = async () => mtime;
    const origWrite = store.write.bind(store);
    store.write = async (b) => {
      await origWrite(b);
      mtime++;
    };
    const index = new ConversationIndex(new FakeProvider(), store, POLICY);
    await index.sync([conv("a", "küche")]);
    const read = vi.spyOn(store, "read");

    await index.loadStored();

    expect(read).not.toHaveBeenCalled();
  });

  it("finds conversations like another, from stored vectors", async () => {
    const index = new ConversationIndex(new FakeProvider(), new MemStore(), POLICY);
    await index.sync([conv("a", "küche hell"), conv("b", "küche neu"), conv("c", "garten")]);

    expect(index.related("a", OPTS).map((r) => r.id)).toEqual(["b"]);
  });

  it("finds conversations that answer a text", async () => {
    const index = new ConversationIndex(new FakeProvider(), new MemStore(), POLICY);
    await index.sync([conv("a", "küche hell"), conv("c", "garten")]);

    expect((await index.query("die küche", OPTS)).map((r) => r.id)).toEqual(["a"]);
    expect(await index.query("die küche", { ...OPTS, exclude: ["a"] })).toEqual([]);
  });

  it("embeds only what changed, and drops what went", async () => {
    const provider = new FakeProvider();
    const store = new MemStore();
    const index = new ConversationIndex(provider, store, POLICY);
    await index.sync([conv("a", "küche"), conv("b", "garten")]);
    provider.embedded = [];

    await index.sync([conv("a", "küche"), conv("c", "garten neu")]);

    expect(provider.embedded).toEqual(["garten neu"]);
    expect(index.size()).toBe(2);
    expect(store.writes).toBe(2);
  });

  it("applies a change set: embeds what changed, keeps the rest without their text", async () => {
    const provider = new FakeProvider();
    const store = new MemStore();
    const index = new ConversationIndex(provider, store, POLICY);
    await index.sync([conv("a", "küche"), conv("b", "garten"), conv("c", "keller")]);
    provider.embedded = [];

    // b changed, c went, d came; a is only named.
    await index.update([conv("b", "garten neu"), conv("d", "dach")], ["d", "b", "a"]);

    expect(provider.embedded.sort()).toEqual(["dach", "garten neu"]);
    expect(index.size()).toBe(3);
    expect(index.vectorsOf("c")).toBeNull();
    expect(index.vectorsOf("a")).not.toBeNull();
  });

  it("drops what is no longer kept, embedding nothing", async () => {
    const provider = new FakeProvider();
    const store = new MemStore();
    const index = new ConversationIndex(provider, store, POLICY);
    await index.sync([conv("a", "küche"), conv("b", "garten")]);
    provider.embedded = [];
    await index.update([], ["a"]);
    expect(provider.embedded).toEqual([]);
    expect(index.size()).toBe(1);
    expect(store.writes).toBe(2);
  });

  it("writes nothing when nothing changed", async () => {
    const store = new MemStore();
    const index = new ConversationIndex(new FakeProvider(), store, POLICY);
    await index.sync([conv("a", "küche")]);
    await index.sync([conv("a", "küche")]);
    expect(store.writes).toBe(1);
  });

  /** A store holding one row for `item` under `contentHash`. */
  const storeWith = (item: ConversationItem, contentHash: string): MemStore => {
    const chunks = conversationChunks(item);
    const store = new MemStore();
    store.buf = serializeIndex(
      [
        {
          id: item.id,
          contentHash,
          chunks: chunks.map(() => quantize(Float32Array.from([1, 0, 0, 0])))
        }
      ],
      4
    );
    return store;
  };

  it("takes over an index Pythia wrote under the same runtime without embedding again", async () => {
    const item = conv("a", "küche");
    const provider = new FakeProvider();
    const store = storeWith(item, POLICY.rowHash(conversationChunks(item)));

    await new ConversationIndex(provider, store, POLICY).sync([item]);

    expect(provider.embedded).toEqual([]);
  });

  it("embeds again a row an older runtime wrote, rather than rank it beside new ones", async () => {
    const item = conv("a", "küche");
    const provider = new FakeProvider();
    // Unmarked: generation 1, the hash every file written before the mark carries.
    const store = storeWith(item, conversationContentHash(conversationChunks(item)));

    const index = new ConversationIndex(provider, store, POLICY);
    await index.sync([item]);

    expect(provider.embedded.length).toBeGreaterThan(0);
    expect(index.size()).toBe(1);
  });

  it("drops a file written by another model", async () => {
    const store = new MemStore();
    store.buf = serializeIndex([{ id: "a", contentHash: "x", chunks: [new Int8Array(8)] }], 8);
    const provider = new FakeProvider();
    await new ConversationIndex(provider, store, POLICY).sync([conv("a", "küche")]);
    expect(provider.embedded.length).toBeGreaterThan(0);
  });
});

describe("ConversationIndex — conversations like a note", () => {
  it("ranks by a note's stored vectors, without embedding", async () => {
    const provider = new FakeProvider();
    const index = new ConversationIndex(provider, new MemStore(), POLICY);
    await index.sync([conv("a", "küche hell"), conv("b", "garten")]);
    provider.embedded = [];

    const noteVectors = [quantize(Float32Array.from([1, 0, 0, 0]))];
    expect((await index.relatedToVectors(noteVectors, OPTS)).map((r) => r.id)).toEqual(["a"]);
    expect(await index.relatedToVectors([], OPTS)).toEqual([]);
    expect(provider.embedded).toEqual([]);
  });

  it("ranks a long note by its first passages, and yields to the UI meanwhile", async () => {
    const provider = new FakeProvider();
    const index = new ConversationIndex(provider, new MemStore(), POLICY);
    await index.sync(
      Array.from({ length: 300 }, (_, i) => conv(`c${i}`, i === 0 ? "küche" : "garten"))
    );
    // The passage that matches comes after the cap: it must not count.
    const noteVectors = Array.from({ length: MAX_SOURCE_CHUNKS + 1 }, (_, i) =>
      quantize(Float32Array.from(i === MAX_SOURCE_CHUNKS ? [1, 0, 0, 0] : [0, 0, 1, 0]))
    );
    let yielded = 0;
    const timers = vi.spyOn(globalThis, "setTimeout");
    timers.mockImplementation(((fn: () => void) => {
      yielded++;
      fn();
      return 0;
    }) as never);
    try {
      const found = await index.relatedToVectors(noteVectors, OPTS);
      expect(found).toEqual([]);
      // 300 items at 2000 / 8 = 250 per yield: the scan yielded once.
      expect(yielded).toBe(1);
    } finally {
      timers.mockRestore();
    }
  });

  it("ranks a query already embedded, without the model", async () => {
    const provider = new FakeProvider();
    const index = new ConversationIndex(provider, new MemStore(), POLICY);
    await index.sync([conv("a", "küche hell"), conv("b", "garten")]);
    provider.embedded = [];
    const query = quantize(Float32Array.from([1, 0, 0, 0]));
    expect(index.queryByVector(query, OPTS).map((r) => r.id)).toEqual(["a"]);
    expect(index.queryByVector(query, { ...OPTS, exclude: ["a"] })).toEqual([]);
    expect(provider.embedded).toEqual([]);
  });
});

describe("ConversationIndex — long and failing conversations", () => {
  it("sends a long conversation a batch at a time", async () => {
    const sizes: number[] = [];
    class Counting extends FakeProvider {
      override async embed(texts: string[]): Promise<Float32Array[]> {
        sizes.push(texts.length);
        return super.embed(texts);
      }
    }
    const long = conv("long", Array.from({ length: 400 }, (_, i) => `küche ${i}`).join(" "));
    const index = new ConversationIndex(new Counting(), new MemStore(), POLICY);
    await index.sync([long]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(16);
  });

  it("keeps the others when one conversation fails, and tries it again later", async () => {
    class FailOnce extends FakeProvider {
      failing = true;
      override async embed(texts: string[]): Promise<Float32Array[]> {
        if (this.failing && texts.some((t) => t.includes("garten"))) throw new Error("bad");
        return super.embed(texts);
      }
    }
    const provider = new FailOnce();
    const store = new MemStore();
    const index = new ConversationIndex(provider, store, POLICY);
    await index.sync([conv("a", "die küche"), conv("b", "der garten")]);
    expect(index.size()).toBe(1);
    provider.failing = false;
    await index.sync([conv("a", "die küche"), conv("b", "der garten")]);
    expect(index.size()).toBe(2);
  });
});
