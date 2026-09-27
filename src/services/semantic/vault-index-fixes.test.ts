// Regressions from the second review of the vault index: each test names the
// failure it guards against.
import { describe, it, expect, vi } from "vitest";
import { VaultIndexService, type IndexableNote } from "./vault-index-service";
import type { IndexStore } from "./index-store";
import { BackendGoneError, type EmbeddingProvider } from "./embedding-provider";
import { deserializeIndex, peekIndexMeta, serializeIndex } from "./embedding-index";
import { optedOut } from "./vault-retrieval";

class FakeProvider implements EmbeddingProvider {
  readonly dim = 4;
  embedded: string[] = [];
  fail: ((text: string) => Error | null) | null = null;
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    const error = this.fail?.(texts.join(" "));
    if (error) throw error;
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
  modified = 0;
  journalStore: MemStore | null = null;
  failRead = false;
  async read(): Promise<ArrayBuffer | null> {
    if (this.failRead) throw new Error("half-synced");
    return this.buf;
  }
  async write(b: ArrayBuffer): Promise<void> {
    this.buf = b;
    this.writes++;
    this.modified++;
  }
  journal(): IndexStore {
    return (this.journalStore ??= new MemStore());
  }
  mtime?: () => Promise<number | null> = undefined;
  enableMtime(): this {
    this.mtime = async () => (this.buf ? this.modified : null);
    return this;
  }
}

const note = (path: string, content: string): IndexableNote => ({
  path,
  load: async () => content
});
const many = (n: number, word = "alpha"): IndexableNote[] =>
  Array.from({ length: n }, (_, i) => note(`n${i}.md`, `note ${i} ${word}`));
const rows = (store: MemStore): string[] =>
  store.buf ? deserializeIndex(store.buf).items.map((r) => r.id) : [];
const tick = (ms = 3) => new Promise((resolve) => setTimeout(resolve, ms));

describe("a model that fails while nothing has been embedded yet", () => {
  it("does not mark the notes of a catch-up as failed for good", async () => {
    const store = new MemStore();
    const notes = many(10);
    await new VaultIndexService(new FakeProvider(), store).sync(notes, undefined, {}, "s");
    // Every other note changed; the model's load fails with a plain error.
    const changed = notes.map((n, i) => (i % 2 ? note(n.path, `changed ${i} beta`) : n));
    const dead = new FakeProvider();
    dead.fail = () => new Error("no available backend found");
    const svc = new VaultIndexService(dead, store);
    await svc.sync(changed, undefined, {}, "s");
    expect(svc.coverage(changed.map((n) => n.path)).failed).toBe(0);

    const healthy = new FakeProvider();
    await new VaultIndexService(healthy, store).sync(changed, undefined, {}, "s");
    expect(healthy.embedded).toHaveLength(5);
  });

  it("stops at once when the backend is gone, and remembers nothing", async () => {
    const store = new MemStore();
    const provider = new FakeProvider();
    let calls = 0;
    provider.fail = (text) => {
      calls++;
      return text.includes("note 2 ") ? new BackendGoneError("Embedding provider unloaded") : null;
    };
    const svc = new VaultIndexService(provider, store, { persistIntervalMs: 0 });
    await expect(svc.sync(many(6))).rejects.toThrow("unloaded");
    expect(calls).toBe(3); // n0, n1, then n2 ended it
    const retry = new FakeProvider();
    await new VaultIndexService(retry, store).sync(many(6));
    expect(retry.embedded.some((t) => t.includes("note 2 "))).toBe(true);
  });

  it("stops when asked to, before the next note", async () => {
    const provider = new FakeProvider();
    const signal = { aborted: false };
    provider.fail = (text) => {
      if (text.includes("note 1 ")) signal.aborted = true;
      return null;
    };
    const svc = new VaultIndexService(provider, new MemStore());
    await expect(svc.sync(many(5), undefined, {}, "s", { signal })).rejects.toThrow("stopped");
    expect(provider.embedded).toHaveLength(2);
  });
});

describe("an edit batch with one bad note", () => {
  it("applies and writes the rest", async () => {
    const store = new MemStore();
    const svc = new VaultIndexService(new FakeProvider(), store, { persistIntervalMs: 0 });
    await svc.sync([note("a.md", "alpha"), note("gone.md", "beta")]);
    const provider = svc["provider"] as FakeProvider;
    provider.fail = (text) => (text.includes("BAD") ? new Error("bad note") : null);
    await svc.applyBatch({
      updates: [note("bad.md", "BAD alpha"), note("c.md", "beta c")],
      removes: ["gone.md"]
    });
    const fresh = new VaultIndexService(new FakeProvider(), store);
    await fresh.hydrateForQuery();
    expect(fresh.vectorsOf("c.md")).not.toBeNull();
    expect(fresh.vectorsOf("gone.md")).toBeNull();
  });

  it("embeds no more than its budget", async () => {
    const provider = new FakeProvider();
    const svc = new VaultIndexService(provider, new MemStore());
    await svc.sync([note("a.md", "alpha")]);
    provider.embedded = [];
    await svc.applyBatch({ updates: many(5, "beta"), removes: [] }, { maxEmbeds: 2 });
    expect(provider.embedded).toHaveLength(2);
  });
});

describe("the phone's journal and the desktop's", () => {
  it("lets a newer desktop edit win over the phone's older one", async () => {
    const store = new MemStore();
    const phoneFile = new MemStore();
    const desktop = new VaultIndexService(new FakeProvider(), store, {
      device: "desktop",
      persistIntervalMs: 0
    });
    await desktop.sync([note("x.md", "alpha")], undefined, {}, "s");

    const phone = new VaultIndexService(new FakeProvider(), store, {
      device: "mobile",
      phoneJournal: phoneFile,
      persistIntervalMs: 0
    });
    await phone.hydrateForQuery();
    await phone.applyBatch({ updates: [note("x.md", "gamma on the phone")], removes: [] });
    await tick();
    // The desktop edits the same note afterwards, into the shared journal.
    await desktop.applyBatch({ updates: [note("x.md", "beta on the desktop")], removes: [] });

    const reopened = new VaultIndexService(new FakeProvider(), store, {
      device: "mobile",
      phoneJournal: phoneFile
    });
    await reopened.hydrateForQuery();
    const [hit] = await reopened.query("beta", { minScore: 0.5 });
    expect(hit?.id).toBe("x.md");
  });
});

describe("a base another device replaced", () => {
  it("is taken over with this device's edits on top, not written against", async () => {
    const store = new MemStore().enableMtime();
    const desktop = new VaultIndexService(new FakeProvider(), store, {
      device: "desktop",
      persistIntervalMs: 0
    });
    await desktop.sync([note("a.md", "alpha"), note("b.md", "beta")], undefined, {}, "s");

    // A phone's Build now writes a new base with a note of its own.
    const phone = new VaultIndexService(new FakeProvider(), store, { device: "mobile" });
    await phone.sync(
      [note("a.md", "alpha"), note("b.md", "beta"), note("p.md", "gamma phone")],
      undefined,
      {},
      "s",
      { maxEmbeds: 5 }
    );

    await desktop.applyBatch({ updates: [note("c.md", "beta desktop edit")], removes: [] });
    const fresh = new VaultIndexService(new FakeProvider(), store);
    await fresh.hydrateForQuery();
    expect(fresh.vectorsOf("c.md")).not.toBeNull(); // the desktop's edit is readable
    expect(fresh.vectorsOf("p.md")).not.toBeNull(); // the phone's note survived it
    expect(peekIndexMeta(store.buf!)?.keeper).toBe("desktop");
  });
});

describe("a phone's merge that cannot read the store", () => {
  it("does not write over it as if it were empty", async () => {
    const store = new MemStore();
    await new VaultIndexService(new FakeProvider(), store).sync(many(3), undefined, {}, "s");
    const before = rows(store);
    const writes = store.writes;
    const provider = new FakeProvider();
    const phone = new VaultIndexService(provider, store, {
      device: "mobile",
      persistIntervalMs: 0
    });
    await phone.hydrateForQuery();
    store.failRead = true;
    await phone.sync(
      [...many(3), ...many(3, "beta").map((n, i) => note(`p${i}.md`, "beta"))],
      undefined,
      {},
      "s",
      {
        maxEmbeds: 1,
        mergeFromStore: true
      }
    );
    store.failRead = false;
    expect(store.writes).toBe(writes);
    expect(rows(store)).toEqual(before);
  });
});

describe("held edits", () => {
  it("report a write that failed on the timer instead of dropping it silently", async () => {
    const store = new MemStore();
    const warn = vi.fn();
    const svc = new VaultIndexService(new FakeProvider(), store, {
      persistIntervalMs: 40,
      logger: { warn }
    });
    await svc.sync([note("a.md", "alpha")]);
    await svc.applyBatch({ updates: [note("b.md", "beta")], removes: [] }); // writes at once
    const fail = async (): Promise<void> => {
      throw new Error("disk full");
    };
    store.write = fail;
    (store.journal() as MemStore).write = fail;
    await svc.applyBatch({ updates: [note("c.md", "beta c")], removes: [] }); // held
    await tick(80);
    expect(warn).toHaveBeenCalledWith(
      "semantic index: held edits could not be written",
      expect.any(Error)
    );
  });
});

describe("deserializeIndex", () => {
  const withRows = (rowsMeta: unknown[], vectors: number): ArrayBuffer => {
    const buf = serializeIndex(
      Array.from({ length: vectors }, (_, i) => ({
        id: `r${i}`,
        contentHash: "h",
        chunks: [new Int8Array(4)]
      })),
      4
    );
    // Rewrite the header's rows in place of the ones serialize wrote.
    const dv = new DataView(buf);
    const metaLen = dv.getUint32(11);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 15, metaLen)));
    head.rows = rowsMeta;
    const bytes = new TextEncoder().encode(JSON.stringify(head));
    const out = new ArrayBuffer(15 + bytes.length + vectors * 4);
    new Uint8Array(out).set(new Uint8Array(buf, 0, 15));
    new DataView(out).setUint32(7, rowsMeta.length);
    new DataView(out).setUint32(11, bytes.length);
    new Uint8Array(out, 15).set(bytes);
    new Uint8Array(out, 15 + bytes.length).set(new Uint8Array(buf, 15 + metaLen));
    return out;
  };

  it("refuses a negative, fractional or missing count, a non-string id, and a repeated id", () => {
    expect(() =>
      withRows(
        [
          { id: "a", h: "h", c: -1 },
          { id: "b", h: "h", c: 3 }
        ],
        2
      )
    ).not.toThrow();
    for (const bad of [
      [
        { id: "a", h: "h", c: -1 },
        { id: "b", h: "h", c: 3 }
      ],
      [
        { id: "a", h: "h", c: 0.5 },
        { id: "b", h: "h", c: 1 }
      ],
      [
        { id: 7, h: "h", c: 1 },
        { id: "b", h: "h", c: 1 }
      ],
      [
        { id: "a", h: "h", c: 1 },
        { id: "a", h: "h", c: 1 }
      ],
      [
        { id: "a", h: null, c: 1 },
        { id: "b", h: "h", c: 1 }
      ]
    ]) {
      expect(() => deserializeIndex(withRows(bad, 2))).toThrow("invalid row");
    }
    expect(
      deserializeIndex(
        withRows(
          [
            { id: "a", h: "h", c: 1 },
            { id: "b", h: "h", c: 1 }
          ],
          2
        )
      ).items
    ).toHaveLength(2);
  });
});

describe("optedOut", () => {
  it('reads both keys alike, false or "false"', () => {
    expect(optedOut({ schreibstubeIndex: false })).toBe(true);
    expect(optedOut({ schreibstubeIndex: "false" })).toBe(true);
    expect(optedOut({ pythia: "false" })).toBe(true);
    expect(optedOut({ schreibstubeIndex: true })).toBe(false);
    expect(optedOut({ schreibstubeIndex: "no" })).toBe(false);
    expect(optedOut(null)).toBe(false);
  });
});
