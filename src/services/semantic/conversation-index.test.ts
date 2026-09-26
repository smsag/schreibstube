import { describe, expect, it } from "vitest";
import { ConversationIndex } from "./conversation-index";
import { conversationChunks, type ConversationItem } from "./conversation-source";
import { conversationContentHash, serializeIndex } from "./embedding-index";
import type { EmbeddingProvider } from "./embedding-provider";
import type { IndexStore } from "./index-store";
import { hashPolicyFor } from "./row-provenance";
import { quantize } from "./vector-math";

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
  messages: [text]
});
const POLICY = hashPolicyFor("xenova-paraphrase-multilingual-MiniLM-L12-v2");
const OPTS = { minScore: 0.5, limit: 10 };

describe("ConversationIndex", () => {
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

  it("writes nothing when nothing changed", async () => {
    const store = new MemStore();
    const index = new ConversationIndex(new FakeProvider(), store, POLICY);
    await index.sync([conv("a", "küche")]);
    await index.sync([conv("a", "küche")]);
    expect(store.writes).toBe(1);
  });

  it("takes over an index Pythia wrote without embedding again", async () => {
    const item = conv("a", "küche");
    const chunks = conversationChunks(item);
    const store = new MemStore();
    store.buf = serializeIndex(
      [
        {
          id: "a",
          contentHash: conversationContentHash(chunks),
          chunks: chunks.map(() => quantize(Float32Array.from([1, 0, 0, 0])))
        }
      ],
      4
    );
    const provider = new FakeProvider();
    const index = new ConversationIndex(provider, store, POLICY);

    await index.sync([item]);

    expect(provider.embedded).toEqual([]);
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
    expect(index.relatedToVectors(noteVectors, OPTS).map((r) => r.id)).toEqual(["a"]);
    expect(index.relatedToVectors([], OPTS)).toEqual([]);
    expect(provider.embedded).toEqual([]);
  });
});
