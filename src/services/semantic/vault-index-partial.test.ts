// What VaultIndexService does short of a finished build: answering while one
// runs, stopping at a phone's budget, merging what another device wrote, and
// the size of what it asks the model at once.
import { describe, it, expect } from "vitest";
import { EMBED_REQUEST_CHUNKS, VaultIndexService, type IndexableNote } from "./vault-index-service";
import type { IndexStore } from "./index-store";
import type { EmbeddingProvider } from "./embedding-provider";
import { deserializeIndex, peekIndexMeta } from "./embedding-index";

class FakeProvider implements EmbeddingProvider {
  readonly dim = 4;
  requests: number[] = [];
  embedded: string[] = [];
  /** Called before each request is answered, so a test can act mid-build. */
  onEmbed: (() => Promise<void> | void) | null = null;
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    await this.onEmbed?.();
    this.requests.push(texts.length);
    this.embedded.push(...texts);
    return texts.map((t) => {
      const v = new Float32Array(4);
      if (t.includes("alpha")) v[0] = 1;
      else if (t.includes("beta")) v[1] = 1;
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

const note = (path: string, content: string): IndexableNote => ({
  path,
  load: async () => content
});
const many = (n: number, topic = "alpha"): IndexableNote[] =>
  Array.from({ length: n }, (_, i) => note(`Notes/n${i}.md`, `note ${i} about ${topic}`));
const rowIds = (store: MemStore): string[] =>
  store.buf ? deserializeIndex(store.buf).items.map((item) => item.id) : [];

describe("VaultIndexService — requests to the model", () => {
  it("sends a long note a model batch at a time, never all at once", async () => {
    const provider = new FakeProvider();
    const svc = new VaultIndexService(provider, new MemStore(), { maxChars: 20 });
    const long = Array.from({ length: 100 }, (_, i) => `alpha${i}`).join(" ");
    await svc.sync([note("Long.md", long)]);
    expect(provider.requests.length).toBeGreaterThan(1);
    expect(Math.max(...provider.requests)).toBeLessThanOrEqual(EMBED_REQUEST_CHUNKS);
    expect(svc.vectorsOf("Long.md")?.length).toBe(provider.embedded.length);
  });

  it("refuses a reply that does not match what was asked", async () => {
    class ShortProvider extends FakeProvider {
      override async embed(texts: string[]): Promise<Float32Array[]> {
        return (await super.embed(texts)).slice(1);
      }
    }
    const svc = new VaultIndexService(new ShortProvider(), new MemStore());
    await svc.sync([note("a.md", "alpha")]);
    // The note is held as failed rather than stored with a missing vector.
    expect(svc.vectorsOf("a.md")).toBeNull();
    expect(svc.size()).toBe(0);
  });
});

describe("VaultIndexService — answering while it builds", () => {
  it("answers from the notes a first build has reached so far", async () => {
    const provider = new FakeProvider();
    const svc = new VaultIndexService(provider, new MemStore());
    const notes = [
      note("a.md", "alpha one"),
      note("b.md", "beta two"),
      note("c.md", "alpha three")
    ];
    let during: string[] | null = null;
    provider.onEmbed = async () => {
      // On the third note, a search arrives: the first two can answer it.
      if (provider.embedded.length === 2 && during === null) {
        provider.onEmbed = null;
        expect(svc.isQueryable()).toBe(true);
        expect(svc.isReady()).toBe(false);
        during = (await svc.query("alpha", { minScore: 0.5 })).map((hit) => hit.id);
      }
    };
    await svc.sync(notes);
    expect(during).toEqual(["a.md"]);
    expect((await svc.query("alpha", { minScore: 0.5 })).map((hit) => hit.id).sort()).toEqual([
      "a.md",
      "c.md"
    ]);
  });

  it("is not queryable before anything has run", () => {
    expect(new VaultIndexService(new FakeProvider(), new MemStore()).isQueryable()).toBe(false);
  });
});

describe("VaultIndexService — a phone's budget", () => {
  it("stops after the budget, keeps what it embedded, and says the index is unfinished", async () => {
    const store = new MemStore();
    const provider = new FakeProvider();
    const svc = new VaultIndexService(provider, store, { device: "mobile" });
    const result = await svc.sync(many(10), undefined, {}, "scope", { maxEmbeds: 4 });
    expect(result).toEqual({ embedded: 4, stopped: true });
    expect(svc.size()).toBe(4);
    expect(svc.isReady()).toBe(true);
    expect(svc.isComplete("scope")).toBe(false);
    expect(peekIndexMeta(store.buf!)?.complete).toBe(false);
    expect(rowIds(store)).toHaveLength(4);
  });

  it("does not count notes it could reuse against the budget", async () => {
    const store = new MemStore();
    const notes = many(6);
    await new VaultIndexService(new FakeProvider(), store).sync(
      notes.slice(0, 3),
      undefined,
      {},
      "s"
    );
    const provider = new FakeProvider();
    const result = await new VaultIndexService(provider, store).sync(notes, undefined, {}, "s", {
      maxEmbeds: 3
    });
    expect(result.stopped).toBe(false);
    expect(provider.embedded).toHaveLength(3);
  });

  it("keeps the rows a desktop wrote while the phone's pass ran", async () => {
    const store = new MemStore();
    const notes = many(6);
    // The desktop has indexed the first note; the phone loads that.
    await new VaultIndexService(new FakeProvider(), store, { device: "desktop" }).sync(
      notes.slice(0, 1),
      undefined,
      {},
      "s"
    );
    const provider = new FakeProvider();
    const phone = new VaultIndexService(provider, store, {
      device: "mobile",
      persistIntervalMs: 0
    });
    provider.onEmbed = async () => {
      // Meanwhile the desktop indexes the last two notes and writes.
      provider.onEmbed = null;
      await new VaultIndexService(new FakeProvider(), store, { device: "desktop" }).sync(
        [notes[0]!, notes[4]!, notes[5]!],
        undefined,
        {},
        "s"
      );
    };
    await phone.sync(notes, undefined, {}, "s", { maxEmbeds: 2, mergeFromStore: true });
    // The phone's two, the desktop's first, and the desktop's two it never reached.
    expect(rowIds(store).sort()).toEqual(
      ["Notes/n0.md", "Notes/n1.md", "Notes/n2.md", "Notes/n4.md", "Notes/n5.md"].sort()
    );
  });

  it("without merging, a pass writes only what it loaded — the loss merging prevents", async () => {
    const store = new MemStore();
    const notes = many(4);
    const provider = new FakeProvider();
    const phone = new VaultIndexService(provider, store, { device: "mobile" });
    provider.onEmbed = async () => {
      provider.onEmbed = null;
      await new VaultIndexService(new FakeProvider(), store).sync([notes[3]!], undefined, {}, "s");
    };
    await phone.sync(notes, undefined, {}, "s", { maxEmbeds: 1 });
    expect(rowIds(store)).toEqual(["Notes/n0.md"]);
  });
});

describe("VaultIndexService — reload", () => {
  it("reads what another device wrote since, and answers from it", async () => {
    const store = new MemStore();
    const phone = new VaultIndexService(new FakeProvider(), store, { device: "mobile" });
    await phone.hydrateForQuery();
    expect(phone.size()).toBe(0);
    await new VaultIndexService(new FakeProvider(), store).sync(many(3), undefined, {}, "s");
    await phone.reload();
    expect(phone.size()).toBe(3);
    expect(phone.isComplete("s")).toBe(true);
    expect((await phone.query("alpha", { minScore: 0.5 })).length).toBe(3);
  });
});

describe("VaultIndexService — out of memory", () => {
  it("stops at once rather than trying the next note into the same heap", async () => {
    class OomProvider extends FakeProvider {
      override async embed(): Promise<Float32Array[]> {
        throw new RangeError("Array buffer allocation failed");
      }
    }
    const provider = new OomProvider();
    const svc = new VaultIndexService(provider, new MemStore());
    await expect(svc.sync(many(3))).rejects.toThrow("allocation failed");
  });
});

describe("VaultIndexService — failures that are not the note's", () => {
  class FailOn extends FakeProvider {
    constructor(private readonly fail: (text: string, calls: number) => Error | null) {
      super();
    }
    calls = 0;
    override async embed(texts: string[]): Promise<Float32Array[]> {
      const error = this.fail(texts.join(" "), ++this.calls);
      if (error) throw error;
      return super.embed(texts);
    }
  }

  it("a dead backend leaves a finished index untouched on disk", async () => {
    const store = new MemStore();
    const notes = many(10);
    await new VaultIndexService(new FakeProvider(), store).sync(notes, undefined, {}, "s");
    const writes = store.writes;
    const changed = notes.map((n, i) => note(n.path, `rewritten ${i}`));
    const dead = new FailOn(() => new Error("worker is not available"));
    await expect(
      new VaultIndexService(dead, store, { persistIntervalMs: 0 }).sync(changed, undefined, {}, "s")
    ).rejects.toThrow("not available");
    expect(store.writes).toBe(writes);
    expect(peekIndexMeta(store.buf!)?.complete).toBe(true);
  });

  it("a failure written just before the backend died is tried again", async () => {
    const store = new MemStore();
    const notes = many(26);
    // n24 fails on its own; n25 runs the heap out.
    const provider = new FailOn((text) =>
      text.includes("note 24 ")
        ? new Error("bad note")
        : text.includes("note 25 ")
          ? new RangeError("Array buffer allocation failed")
          : null
    );
    await expect(
      new VaultIndexService(provider, store, { persistIntervalMs: 0 }).sync(notes)
    ).rejects.toThrow("allocation failed");
    expect(rowIds(store)).not.toContain("Notes/n24.md");

    const retry = new FakeProvider();
    await new VaultIndexService(retry, store).sync(notes);
    expect(retry.embedded.some((t) => t.includes("note 24 "))).toBe(true);
  });

  it("a deadline is not remembered as a failure, and the note keeps its old row", async () => {
    const store = new MemStore();
    await new VaultIndexService(new FakeProvider(), store).sync([note("a.md", "alpha old")]);
    const slow = new FailOn(() => new Error("Embedding request 3 timed out"));
    const svc = new VaultIndexService(slow, store);
    await svc.sync([note("a.md", "alpha new")]);
    expect(svc.vectorsOf("a.md")).not.toBeNull(); // the old vectors, until a build gets through
    const retry = new FakeProvider();
    await new VaultIndexService(retry, store).sync([note("a.md", "alpha new")]);
    expect(retry.embedded).toHaveLength(1);
  });

  it("a phone does not remember failures in the desktop's file", async () => {
    const store = new MemStore();
    const phone = new VaultIndexService(new FailOn(() => new Error("bad")), store, {
      device: "mobile"
    });
    await phone.sync([note("a.md", "alpha")]);
    expect(rowIds(store)).toEqual([]);
  });
});

describe("VaultIndexService — the budget, exactly spent", () => {
  it("is not 'stopped' when what is left can all be reused", async () => {
    const store = new MemStore();
    const notes = many(6);
    await new VaultIndexService(new FakeProvider(), store).sync(notes.slice(3), undefined, {}, "s");
    const svc = new VaultIndexService(new FakeProvider(), store);
    const result = await svc.sync(notes, undefined, {}, "s", { maxEmbeds: 3 });
    expect(result).toEqual({ embedded: 3, stopped: false });
    expect(svc.isComplete("s")).toBe(true);
  });

  it("still drops notes that are gone when it stops", async () => {
    const store = new MemStore();
    await new VaultIndexService(new FakeProvider(), store).sync([note("gone.md", "alpha")]);
    const svc = new VaultIndexService(new FakeProvider(), store);
    const result = await svc.sync(many(3), undefined, {}, "s", { maxEmbeds: 1 });
    expect(result.stopped).toBe(true);
    expect(rowIds(store)).toEqual(["Notes/n0.md"]);
  });
});

describe("VaultIndexService — reading without waiting", () => {
  it("does not queue a reader of the rows behind a running build", async () => {
    let release: () => void = () => undefined;
    const provider = new FakeProvider();
    provider.onEmbed = () => new Promise<void>((resolve) => (release = resolve));
    const svc = new VaultIndexService(provider, new MemStore());
    const build = svc.sync([note("a.md", "alpha")]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    let read = false;
    await Promise.race([
      svc.loadPersisted().then(() => (read = true)),
      new Promise((resolve) => setTimeout(resolve, 20))
    ]);
    expect(read).toBe(true);
    provider.onEmbed = null;
    release();
    await build;
  });

  it("tells whether the base on disk is another one than it holds, by its modification time", async () => {
    let mtime = 1;
    const store = new (class extends MemStore {
      async mtime(): Promise<number | null> {
        return this.buf ? mtime : null;
      }
    })();
    const svc = new VaultIndexService(new FakeProvider(), store);
    await svc.sync([note("a.md", "alpha")]);
    expect(await svc.baseReplacedOnDisk()).toBe(false);
    mtime = 2; // another device's write, delivered by sync
    expect(await svc.baseReplacedOnDisk()).toBe(true);
    await svc.reload();
    expect(await svc.baseReplacedOnDisk()).toBe(false);
    // A store that cannot tell reads as unchanged.
    const plain = new VaultIndexService(new FakeProvider(), new MemStore());
    await plain.sync([note("a.md", "alpha")]);
    expect(await plain.baseReplacedOnDisk()).toBe(false);
  });
});

describe("VaultIndexService — what it reports", () => {
  it("counts indexed, failed and missing notes, and the passages held", async () => {
    class FailOnGamma extends FakeProvider {
      override async embed(texts: string[]): Promise<Float32Array[]> {
        if (texts.some((t) => t.includes("gamma"))) throw new Error("bad");
        return super.embed(texts);
      }
    }
    const svc = new VaultIndexService(new FailOnGamma(), new MemStore());
    const details: { embedded: number; failed: number; reused: number; passages: number }[] = [];
    await svc.sync(
      [note("a.md", "alpha"), note("b.md", "beta"), note("g.md", "gamma")],
      (_done, _total, detail) => details.push(detail)
    );
    expect(details.at(-1)).toMatchObject({ embedded: 2, failed: 1, reused: 0, passages: 2 });
    expect(svc.coverage(["a.md", "b.md", "g.md", "new.md"])).toEqual({
      indexed: 2,
      failed: 1,
      missing: 1,
      passages: 2
    });
  });
});

describe("VaultIndexService — a phone's own edits", () => {
  const desktopIndex = async (store: MemStore): Promise<void> => {
    await new VaultIndexService(new FakeProvider(), store, { device: "desktop" }).sync(
      [note("a.md", "alpha")],
      undefined,
      {},
      "s"
    );
  };
  const phone = (store: MemStore, journal: MemStore): VaultIndexService =>
    new VaultIndexService(new FakeProvider(), store, {
      device: "mobile",
      phoneJournal: journal,
      persistIntervalMs: 0
    });

  it("keeps a note written on the phone across a restart, without touching the desktop's files", async () => {
    const store = new MemStore();
    await desktopIndex(store);
    const writes = store.writes;
    const journal = new MemStore();
    const first = phone(store, journal);
    await first.hydrateForQuery();
    await first.applyBatch({ updates: [note("new.md", "beta written on the phone")], removes: [] });
    expect(store.writes).toBe(writes); // the desktop's file is the desktop's
    expect(journal.writes).toBe(1);

    const second = phone(store, journal);
    await second.hydrateForQuery();
    expect(second.vectorsOf("new.md")).not.toBeNull();
    expect(second.isComplete("s")).toBe(true); // still the desktop's index
    expect(second.signature().keeper).toBe("desktop");
  });

  it("lets the phone's edits go once the desktop writes a new base", async () => {
    const store = new MemStore();
    await desktopIndex(store);
    const journal = new MemStore();
    const first = phone(store, journal);
    await first.hydrateForQuery();
    await first.applyBatch({ updates: [note("new.md", "beta")], removes: [] });

    // The desktop saw the edit and rebuilt; the phone's journal is now stale.
    // A base is known by its write time, so the two writes must not share a millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await new VaultIndexService(new FakeProvider(), store, { device: "desktop" }).sync(
      [note("a.md", "alpha"), note("other.md", "gamma")],
      undefined,
      {},
      "s"
    );
    const second = phone(store, journal);
    await second.hydrateForQuery();
    expect(second.vectorsOf("new.md")).toBeNull();
    expect(second.vectorsOf("other.md")).not.toBeNull();
  });
});

describe("VaultIndexService — queries", () => {
  it("asks for a query ahead of waiting batches, and embeds a repeated one only once", async () => {
    const asked: { texts: string[]; priority: boolean }[] = [];
    class Recording extends FakeProvider {
      override async embed(
        texts: string[],
        options?: { priority?: boolean }
      ): Promise<Float32Array[]> {
        asked.push({ texts, priority: options?.priority === true });
        return super.embed(texts);
      }
    }
    const svc = new VaultIndexService(new Recording(), new MemStore());
    await svc.sync([note("a.md", "alpha"), note("b.md", "beta")]);
    asked.length = 0;

    const timing = { embedMs: -1, rankMs: -1, cached: true, notes: 0 };
    await svc.query("alpha", { minScore: 0.5, timing });
    expect(asked).toEqual([{ texts: ["alpha"], priority: true }]);
    expect(timing.cached).toBe(false);
    expect(timing.notes).toBe(2);
    expect(timing.embedMs).toBeGreaterThanOrEqual(0);

    const again = { embedMs: -1, rankMs: -1, cached: false, notes: 0 };
    const hits = await svc.query("alpha", { minScore: 0.5, timing: again });
    expect(asked).toHaveLength(1); // from memory
    expect(again.cached).toBe(true);
    expect(hits.map((h) => h.id)).toEqual(["a.md"]);
  });
});
