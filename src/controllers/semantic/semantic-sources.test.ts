import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";
import { SemanticSources } from "./semantic-sources";
import { MAX_EMBED_TRIES } from "./source-index";
import { PHRASE_FLOOR, WORD_FLOOR } from "../../services/semantic/search-fusion";
import type { EmbeddingProvider } from "../../services/semantic/embedding-provider";
import { NULL_LOGGER } from "../../services/logger";
import { deserializeIndex, serializeIndex } from "../../services/semantic/embedding-index";
import {
  MAX_SOURCES,
  itemKey,
  readSource,
  type SourceConsent
} from "../../services/semantic/semantic-api";

class FakeProvider implements EmbeddingProvider {
  readonly dim = 4;
  embedded: string[] = [];
  /** While set, a batch with a text containing "garten" waits for it. */
  gate: Promise<void> | null = null;
  /** While set, a batch with a text containing it fails, and is counted. */
  failOn: string | null = null;
  failed = 0;
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.gate && texts.some((t) => t.includes("garten"))) await this.gate;
    const fail = this.failOn;
    if (fail !== null && texts.some((t) => t.includes(fail))) {
      this.failed++;
      throw new Error("embed failed");
    }
    this.embedded.push(...texts);
    return texts.map((t) => Float32Array.from(t.includes("küche") ? [1, 0, 0, 0] : [0, 1, 0, 0]));
  }
  unload(): void {}
}

const MODEL = "xenova-paraphrase-multilingual-MiniLM-L12-v2";
const FILE = (id: string) => `.obsidian/plugins/schreibstube/semantic-source-${id}-${MODEL}.bin`;
const KITCHEN = [new Int8Array([127, 0, 0, 0])];
const QUERY = { minScore: 0.35, limit: 5, exclude: new Set<string>() };
const BESIDE = { minScore: 0.62, limit: 5 };

type Item = { id: string; title: string; updatedAt: number; summary: string; messages: string[] };

function setup(files: Record<string, ArrayBuffer> = {}) {
  const disk = new Map(Object.entries(files));
  const plugin = {
    app: {
      vault: {
        configDir: ".obsidian",
        adapter: {
          exists: async (p: string) => disk.has(p) || p === ".obsidian/plugins/schreibstube",
          readBinary: async (p: string) => {
            state.readsStarted++;
            if (state.readWait) await state.readWait;
            return disk.get(p) ?? new ArrayBuffer(0);
          },
          writeBinary: async (p: string, b: ArrayBuffer) => void disk.set(p, b),
          rename: async (from: string, to: string) => {
            disk.set(to, disk.get(from)!);
            disk.delete(from);
          },
          remove: async (p: string) => void disk.delete(p),
          mkdir: async () => undefined,
          list: async (dir: string) => ({
            files: [...disk.keys()].filter((p) => p.startsWith(`${dir}/`)),
            folders: []
          })
        }
      }
    },
    manifest: { id: "schreibstube", dir: ".obsidian/plugins/schreibstube" }
  } as unknown as Plugin;
  const provider = new FakeProvider();
  /** `background`: a desktop with nothing else running; false is a phone. */
  const state = {
    enabled: true,
    background: true,
    phone: false,
    vector: null as Int8Array | null,
    /** While set, a read of a file waits for it. */
    readWait: null as Promise<void> | null,
    readsStarted: 0
  };
  const answers: Record<string, SourceConsent> = { pythia: "allowed", reader: "allowed" };
  const asked: string[] = [];
  const sources = new SemanticSources({
    plugin,
    logger: NULL_LOGGER,
    enabled: () => state.enabled,
    modelId: () => MODEL,
    provider: () => provider,
    changed: () => undefined,
    mayEmbedInBackground: () => state.background,
    embedsHere: () => !state.phone,
    queryVector: async () => state.vector,
    modelWork: (work) => work(),
    consent: (id) => answers[id] ?? "pending",
    askConsent: (id) => void asked.push(id)
  });

  const makeSource = (items: Item[], extra: Record<string, unknown> = {}) => {
    let notify: () => void = () => undefined;
    const raw = {
      kind: "conversation",
      label: "Conversation",
      plural: "Conversations",
      list: vi.fn(() => items),
      onChanged: (cb: () => void) => {
        notify = cb;
        return () => undefined;
      },
      ...extra
    };
    const read = readSource(raw, () => true);
    if (!("source" in read)) throw new Error(read.problem);
    return { raw, ...read, notify: () => notify() };
  };
  const listed: Item[] = [
    { id: "c1", title: "", updatedAt: 2, summary: "", messages: ["die küche"] },
    { id: "c2", title: "", updatedAt: 1, summary: "", messages: ["der garten"] }
  ];
  const pythia = makeSource(listed);
  const register = (id = "pythia", s = pythia) => sources.register(id, s.source, s.descriptor);
  return { sources, provider, state, answers, asked, disk, makeSource, pythia, listed, register };
}

const ids = (hits: { key: string }[]) => hits.map((hit) => hit.key);
const key = (id: string, source = "pythia") => itemKey(source, id);
const one = (id: string, text = "küche"): Item[] => [
  { id, title: "", updatedAt: 1, summary: "", messages: [text] }
];

// The list deadline sets a timer on `window`, which a node test does not have.
vi.stubGlobal("window", globalThis);

describe("a registered source", () => {
  it("is listed once, and again only after it said something changed", async () => {
    const s = setup();
    s.register();
    expect(ids(await s.sources.search("küche", QUERY))).toEqual([key("c1")]);
    await s.sources.search("küche", QUERY);
    expect(s.pythia.raw.list).toHaveBeenCalledTimes(1);

    s.listed.push({ id: "c3", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    s.pythia.notify();
    expect(ids(await s.sources.search("küche", QUERY)).sort()).toEqual([key("c1"), key("c3")]);
    expect(s.pythia.raw.list).toHaveBeenCalledTimes(2);
  });

  it("answers nothing while search by meaning is off, and after it was let go", async () => {
    const s = setup();
    s.state.enabled = false;
    const registration = s.register();
    expect(await s.sources.search("küche", QUERY)).toEqual([]);
    s.state.enabled = true;
    registration.release();
    expect(await s.sources.search("küche", QUERY)).toEqual([]);
  });

  it("names an item by the title its source gave, without the model", async () => {
    const s = setup();
    s.listed[0]!.title = "Exposé";
    s.state.background = false;
    s.register();
    await s.sources.relatedToVectors(KITCHEN, BESIDE);
    expect(s.sources.titleOf(key("c1"))).toBe("Exposé");
    expect(s.provider.embedded).toEqual([]);
  });

  it("names the items a note was attached to, as keys", async () => {
    const s = setup();
    (s.listed[0] as Record<string, unknown>).notes = ["Projekte/readme.md"];
    s.register();
    await s.sources.relatedToVectors(KITCHEN, BESIDE);
    expect(s.sources.attachedTo("Projekte/readme.md")).toEqual([key("c1")]);
    expect(s.sources.attachedTo("Anderes.md")).toEqual([]);
  });

  it("reads the floor it is given", async () => {
    const s = setup();
    s.register();
    await s.sources.search("küche", QUERY);
    const vector = [new Int8Array([81, 98, 0, 0])]; // cosine 0.638 against c1
    expect(ids(await s.sources.relatedToVectors(vector, BESIDE))).toContain(key("c1"));
    expect(
      ids(await s.sources.relatedToVectors(vector, { ...BESIDE, minScore: 0.65 }))
    ).not.toContain(key("c1"));
  });
});

describe("the person's answer", () => {
  it("is asked for a source never answered, and nothing of it is read meanwhile", async () => {
    const s = setup();
    const other = s.makeSource(one("h1"));
    const registration = s.register("stranger", other);
    expect(s.asked).toEqual(["stranger"]);
    expect(registration.consent()).toBe("pending");
    expect(await s.sources.search("küche", QUERY)).toEqual([]);
    expect(other.raw.list).not.toHaveBeenCalled();
  });

  it("lets a source in once allowed, and out again when refused", async () => {
    const s = setup();
    s.register("stranger", s.makeSource(one("h1")));
    s.answers.stranger = "allowed";
    await s.sources.consentChanged("stranger");
    expect(ids(await s.sources.search("küche", QUERY))).toEqual([key("h1", "stranger")]);
    s.answers.stranger = "denied";
    expect(await s.sources.search("küche", QUERY)).toEqual([]);
    expect(s.sources.titleOf(key("h1", "stranger"))).toBeNull();
  });
});

describe("two sources", () => {
  it("keep their items apart, however alike their ids", async () => {
    const s = setup();
    s.register();
    const reader = s.makeSource([
      { id: "c1", title: "Markierung", updatedAt: 1, summary: "", messages: ["küche"] }
    ]);
    s.register("reader", reader);
    const found = ids(await s.sources.search("küche", QUERY));
    expect(found.sort()).toEqual([key("c1"), key("c1", "reader")].sort());
    expect(s.disk.has(FILE("pythia"))).toBe(true);
    expect(s.disk.has(FILE("reader"))).toBe(true);
    expect(s.sources.titleOf(key("c1", "reader"))).toBe("Markierung");
  });

  it("answer only the sources asked for", async () => {
    const s = setup();
    s.register();
    s.register("reader", s.makeSource(one("r1")));
    const found = ids(await s.sources.search("küche", { ...QUERY, only: new Set(["reader"]) }));
    expect(found).toEqual([key("r1", "reader")]);
  });

  it("are capped, since each holds an index in memory", () => {
    const s = setup();
    for (let i = 0; i < MAX_SOURCES; i++) s.register(`s${i}`, s.makeSource([]));
    expect(() => s.register("one-more", s.makeSource([]))).toThrow(/at most/);
    expect(() => s.register("s0", s.makeSource([]))).not.toThrow();
  });
});

/**
 * A source with a cursor, as Pythia keeps one: each item's revision, so what
 * changed and what went is a comparison, never a clock.
 */
function cursorSource(
  s: ReturnType<typeof setup>,
  items: Item[],
  answer?: (c: string | null) => unknown
) {
  const revision = (item: Item) => `${item.updatedAt}|${item.messages.join("")}|${item.title}`;
  const changes = vi.fn((cursor: string | null) => {
    if (answer) return answer(cursor);
    const seen: Record<string, string> = cursor ? JSON.parse(cursor) : {};
    const now = Object.fromEntries(items.map((item) => [item.id, revision(item)]));
    return {
      changed: items.filter((item) => seen[item.id] !== now[item.id]),
      removed: Object.keys(seen).filter((id) => !(id in now)),
      cursor: JSON.stringify(now)
    };
  });
  return { ...s.makeSource(items, { changes }), changes };
}

describe("a source with a cursor", () => {
  const item = (id: string, text: string, updatedAt = 1): Item => ({
    id,
    title: "",
    updatedAt,
    summary: "",
    messages: [text]
  });

  it("is asked for what changed since its cursor, and never for the whole list", async () => {
    const s = setup();
    const items = [item("a", "küche"), item("b", "garten")];
    const src = cursorSource(s, items);
    s.register("pythia", src);
    await s.sources.search("küche", QUERY);
    expect(src.changes).toHaveBeenCalledWith(null);

    items.push(item("c", "küche neu"));
    items.splice(0, 1);
    src.notify();
    s.provider.embedded = [];
    expect(ids(await s.sources.search("küche", QUERY))).toEqual([key("c")]);
    expect(src.changes.mock.calls[1]?.[0]).not.toBeNull();
    expect(src.raw.list).not.toHaveBeenCalled();
    expect(s.provider.embedded).toContain("küche neu");
    expect(s.provider.embedded).not.toContain("garten");
  });

  it("finds an item older than every one it read before, which a clock would miss", async () => {
    const s = setup();
    const items = [item("a", "garten", 50)];
    const src = cursorSource(s, items);
    s.register("pythia", src);
    await s.sources.search("küche", QUERY);
    // Synced in from another device, dated before anything read so far.
    items.push(item("old", "küche", 1));
    src.notify();
    expect(ids(await s.sources.search("küche", QUERY))).toEqual([key("old")]);
  });

  it("is not blinded by an item dated in the future", async () => {
    const s = setup();
    const items = [item("a", "garten", Date.now() + 10 ** 12)];
    const src = cursorSource(s, items);
    s.register("pythia", src);
    await s.sources.search("küche", QUERY);
    items.push(item("b", "küche", 5));
    src.notify();
    expect(ids(await s.sources.search("küche", QUERY))).toEqual([key("b")]);
  });

  it("is read whole when its answer is not one, and keeps answering meanwhile", async () => {
    const s = setup();
    const items = [item("a", "küche")];
    let broken = false;
    const src = cursorSource(s, items, (cursor) =>
      broken ? "no" : { changed: cursor ? [] : items, removed: [], cursor: "1" }
    );
    s.register("pythia", src);
    expect(ids(await s.sources.search("küche", QUERY))).toEqual([key("a")]);
    broken = true;
    items.push(item("b", "küche neu"));
    src.notify();
    const found = ids(await s.sources.search("küche", QUERY)).sort();
    expect(found).toEqual([key("a"), key("b")]);
    expect(src.raw.list).toHaveBeenCalledTimes(1);
  });

  it("replaces its listing with the answer to a null cursor, even after it was read whole", async () => {
    const s = setup();
    const items = [item("a", "küche"), item("b", "küche zwei")];
    let broken = true;
    const src = cursorSource(s, items, () =>
      broken ? "no" : { changed: items, removed: [], cursor: "1" }
    );
    s.register("pythia", src);
    expect(ids(await s.sources.search("küche", QUERY)).sort()).toEqual([key("a"), key("b")]);
    broken = false;
    items.splice(0, 1);
    src.notify();
    expect(ids(await s.sources.search("küche", QUERY))).toEqual([key("b")]);
    expect(src.changes).toHaveBeenLastCalledWith(null);
  });

  it("drops an answer that arrives after its listing was forgotten, and reads everything again", async () => {
    const s = setup();
    const items = [item("a", "küche"), item("b", "küche zwei")];
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const src = cursorSource(s, items, (cursor) =>
      cursor === null
        ? { changed: items, removed: [], cursor: "1" }
        : gate.then(() => ({ changed: [item("c", "küche drei")], removed: [], cursor: "2" }))
    );
    s.register("pythia", src);
    await s.sources.search("küche", QUERY);
    src.notify();
    const searching = s.sources.search("küche", QUERY);
    await vi.waitFor(() => expect(src.changes).toHaveBeenCalledTimes(2));
    s.sources.reset();
    open();
    await searching;

    expect(ids(await s.sources.search("küche", QUERY)).sort()).toEqual([key("a"), key("b")]);
    expect(src.changes).toHaveBeenLastCalledWith(null);
  });

  it("tries an item again whose embed failed, though the source will not list it again", async () => {
    const s = setup();
    const items = [item("a", "küche")];
    const src = cursorSource(s, items);
    s.register("pythia", src);
    await s.sources.search("küche", QUERY);
    items.push(item("b", "küche zwei"));
    src.notify();
    s.provider.failOn = "zwei";
    expect(ids(await s.sources.search("küche", QUERY))).toEqual([key("a")]);

    s.provider.failOn = null;
    expect(ids(await s.sources.search("küche", QUERY)).sort()).toEqual([key("a"), key("b")]);
  });

  it("leaves an item that keeps failing until it changes, rather than trying it at every sync", async () => {
    const s = setup();
    const items = [item("a", "küche"), item("b", "küche zwei")];
    const src = cursorSource(s, items);
    s.provider.failOn = "zwei";
    s.register("pythia", src);
    for (let i = 0; i < MAX_EMBED_TRIES + 2; i++) await s.sources.search("küche", QUERY);
    expect(s.provider.failed).toBe(MAX_EMBED_TRIES);

    s.provider.failOn = null;
    items[1] = item("b", "küche zwei neu", 2);
    src.notify();
    expect(ids(await s.sources.search("küche", QUERY)).sort()).toEqual([key("a"), key("b")]);
  });

  it("holds titles, not texts, once an item is embedded", async () => {
    const s = setup();
    const items = [item("a", "küche")];
    items[0]!.title = "Küche";
    const src = cursorSource(s, items);
    s.register("pythia", src);
    await s.sources.search("küche", QUERY);
    const index = (
      s.sources as unknown as { entries: Map<string, { index: unknown }> }
    ).entries.get("pythia")!.index as { pending: Map<string, unknown>; meta: Map<string, object> };
    expect(index.pending.size).toBe(0);
    expect(Object.keys(index.meta.get("a")!)).toEqual(["title", "notes", "updatedAt"]);
    expect(s.sources.titleOf(key("a"))).toBe("Küche");
  });
});

describe("a source that stops or is refused", () => {
  it("counts its listing as syncing, so the model is not taken from under it", async () => {
    const s = setup();
    let answer: (items: Item[]) => void = () => undefined;
    const slow = s.makeSource(s.listed, {
      list: () => new Promise<Item[]>((resolve) => (answer = resolve))
    });
    s.register("pythia", slow);
    const searching = s.sources.search("küche", QUERY);
    await vi.waitFor(() => expect(s.sources.isSyncing()).toBe(true));
    answer(s.listed);
    await searching;
    expect(s.sources.isSyncing()).toBe(false);
  });

  it("embeds and writes nothing once released, even mid-listing", async () => {
    const s = setup();
    let answer: (items: Item[]) => void = () => undefined;
    const slow = s.makeSource(s.listed, {
      list: () => new Promise<Item[]>((resolve) => (answer = resolve))
    });
    const registration = s.register("pythia", slow);
    const searching = s.sources.search("küche", QUERY);
    await vi.waitFor(() => expect(s.sources.isSyncing()).toBe(true));
    registration.release();
    answer(s.listed);
    await searching;
    expect(s.provider.embedded.filter((t) => t !== "küche")).toEqual([]);
    expect(s.disk.has(FILE("pythia"))).toBe(false);
  });

  it("registered again mid-embed, writes only after the old index has", async () => {
    const s = setup();
    let open: () => void = () => undefined;
    s.provider.gate = new Promise<void>((resolve) => (open = resolve));
    s.register();
    const first = s.sources.search("küche", QUERY);
    await vi.waitFor(() => expect(s.sources.isSyncing()).toBe(true));
    s.register("pythia", s.makeSource(one("c3", "küche neu")));
    const second = s.sources.search("küche", QUERY);
    await new Promise((r) => setTimeout(r, 10));
    expect(s.provider.embedded).not.toContain("küche neu");
    open();
    await first;
    expect(ids(await second)).toEqual([key("c3")]);
    const stored = deserializeIndex(s.disk.get(FILE("pythia"))!);
    expect(stored.items.map((item) => item.id)).toEqual(["c3"]);
  });

  it("embeds nothing when refused while its list was on the way", async () => {
    const s = setup();
    let answer: (items: Item[]) => void = () => undefined;
    const slow = s.makeSource(s.listed, {
      list: () => new Promise<Item[]>((resolve) => (answer = resolve))
    });
    s.register("pythia", slow);
    const searching = s.sources.search("küche", QUERY);
    await vi.waitFor(() => expect(s.sources.isSyncing()).toBe(true));
    s.answers.pythia = "denied";
    answer(s.listed);
    await searching;
    expect(s.disk.has(FILE("pythia"))).toBe(false);
  });

  it("puts nothing back in memory when refused while its listing was on the way", async () => {
    const s = setup();
    let answer: (items: Item[]) => void = () => undefined;
    const slow = s.makeSource(s.listed, {
      list: () => new Promise<Item[]>((resolve) => (answer = resolve))
    });
    s.register("pythia", slow);
    const searching = s.sources.search("küche", QUERY);
    await vi.waitFor(() => expect(s.sources.isSyncing()).toBe(true));
    s.answers.pythia = "denied";
    const refused = s.sources.consentChanged("pythia");
    answer(s.listed);
    await refused;
    await searching;

    expect(s.sources.registered()[0]).toMatchObject({ size: 0, listed: false });
    expect(s.sources.titleOf(key("c1"))).toBeNull();
  });

  it("leaves nothing behind when refused: no titles in memory, no file on disk", async () => {
    const s = setup();
    s.register();
    await s.sources.search("küche", QUERY);
    expect(s.disk.has(FILE("pythia"))).toBe(true);
    s.answers.pythia = "denied";
    await s.sources.consentChanged("pythia");
    expect(s.disk.has(FILE("pythia"))).toBe(false);
    expect(s.sources.registered()[0]).toMatchObject({ size: 0, listed: false });
  });

  it("leaves the files of a source whose id begins with its own when refused", async () => {
    const s = setup();
    s.answers["pythia-notes"] = "allowed";
    s.register();
    s.register("pythia-notes", s.makeSource(one("n1")));
    await s.sources.search("küche", QUERY);
    expect(s.disk.has(FILE("pythia-notes"))).toBe(true);
    s.answers.pythia = "denied";
    await s.sources.consentChanged("pythia");
    expect(s.disk.has(FILE("pythia"))).toBe(false);
    expect(s.disk.has(FILE("pythia-notes"))).toBe(true);
  });

  it("is refused a registration after the plugin unloaded", () => {
    const s = setup();
    s.sources.dispose();
    expect(() => s.register()).toThrow(/unloaded/);
  });
});

describe("being asked", () => {
  it("waits while search by meaning is off, and asks once it is switched on", () => {
    const s = setup();
    s.state.enabled = false;
    s.register("stranger", s.makeSource([]));
    expect(s.asked).toEqual([]);
    s.state.enabled = true;
    s.sources.askPending();
    expect(s.asked).toEqual(["stranger"]);
  });
});

describe("on a phone", () => {
  it("shows a source's items in a search, titled, from the stored index", async () => {
    const s = setup({
      [FILE("pythia")]: serializeIndex([{ id: "c1", contentHash: "x", chunks: KITCHEN }], 4)
    });
    s.state.phone = true;
    s.state.background = false;
    s.listed[0]!.title = "Küche";
    s.register();
    const found = await s.sources.find("küche", 5, PHRASE_FLOOR);
    expect(found.map((r) => [r.key, r.title])).toEqual([[key("c1"), "Küche"]]);
    expect(s.provider.embedded).toEqual(["küche"]);
  });
});

describe("searches arriving together on a phone", () => {
  const phone = () => {
    const s = setup({
      [FILE("pythia")]: serializeIndex(
        [
          { id: "c1", contentHash: "x", chunks: KITCHEN },
          { id: "c2", contentHash: "y", chunks: [new Int8Array([0, 127, 0, 0])] }
        ],
        4
      )
    });
    s.state.phone = true;
    s.state.background = false;
    s.register();
    return s;
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("run the model one after another", async () => {
    const s = phone();
    let open: () => void = () => undefined;
    s.provider.gate = new Promise((r) => (open = r));
    const garten = s.sources.search("garten", QUERY);
    const kitchen = s.sources.search("küche", QUERY);
    await tick();
    await tick();
    expect(s.provider.embedded).toEqual([]); // küche waits for garten's model run

    open();
    expect(ids(await garten)).toEqual([key("c2")]);
    expect(ids(await kitchen)).toEqual([key("c1")]);
    expect(s.provider.embedded).toEqual(["garten", "küche"]);
  });

  it("share one model run when they ask the same", async () => {
    const s = phone();
    const [a, b] = await Promise.all([
      s.sources.search("küche", QUERY),
      s.sources.search("küche", QUERY)
    ]);
    expect(ids(a)).toEqual([key("c1")]);
    expect(ids(b)).toEqual([key("c1")]);
    expect(s.provider.embedded).toEqual(["küche"]);
  });

  it("are not answered from a second copy of the index when the source registers again mid-read", async () => {
    const s = phone();
    let open: () => void = () => undefined;
    s.state.readWait = new Promise((r) => (open = r));
    const before = s.sources.search("küche", QUERY);
    await tick();
    s.register(); // e.g. Pythia reloaded
    const after = s.sources.search("küche", QUERY);
    await tick();
    await tick();
    expect(s.state.readsStarted).toBe(1); // the new index waits for the old read

    s.state.readWait = null;
    open();
    await before;
    expect(ids(await after)).toEqual([key("c1")]);
  });
});

describe("the Explorer's items", () => {
  it("are capped per source, so one source cannot push the others off", async () => {
    const s = setup();
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `k${i}`,
      title: `Küche ${i}`,
      updatedAt: i,
      summary: "",
      messages: ["küche"]
    }));
    s.register("pythia", s.makeSource(many));
    s.register("reader", s.makeSource([{ ...one("r1")[0]!, title: "Küche Leser" }]));
    (s.listed as unknown[]).length = 0;
    const found = await s.sources.find("küche", 3, PHRASE_FLOOR);
    expect(found.filter((r) => r.source === "pythia")).toHaveLength(3);
    expect(found.filter((r) => r.source === "reader")).toHaveLength(1);
  });

  it("hold a lone word's items to the relative cut, not to the bare floor", async () => {
    const s = setup();
    s.listed[0]!.title = "Eins";
    s.listed[1]!.title = "Zwei";
    s.register();
    // Close to the kitchen, and just above the phrase floor for the garden.
    s.state.vector = new Int8Array([118, 47, 0, 0]);
    expect((await s.sources.find("küche", 5, PHRASE_FLOOR)).map((r) => r.key).sort()).toEqual([
      key("c1"),
      key("c2")
    ]);
    expect((await s.sources.find("küche", 5, WORD_FLOOR)).map((r) => r.key)).toEqual([key("c1")]);
  });
});

describe("an item's link and its opening", () => {
  it("are the source's, and a link it may not open is not given", () => {
    const s = setup();
    const open = vi.fn();
    const linked = s.makeSource(s.listed, {
      open,
      link: (id: string) => (id === "c1" ? `obsidian://pythia?id=${id}` : "javascript:alert(1)")
    });
    s.register("pythia", linked);
    expect(s.sources.open(key("c1"))).toBe(true);
    expect(open).toHaveBeenCalledWith("c1");
    expect(s.sources.link(key("c1"))).toBe("obsidian://pythia?id=c1");
    expect(s.sources.link(key("c2"))).toBeNull();
    expect(s.sources.open("Notiz.md")).toBe(false);
  });
});

describe("the model", () => {
  it("is not loaded for Recommended to embed a changed item", async () => {
    const s = setup();
    s.register();
    await s.sources.search("küche", QUERY);
    const embedded = s.provider.embedded.length;
    s.listed.push({ id: "c3", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    s.pythia.notify();
    s.state.background = false;
    await s.sources.relatedToVectors(KITCHEN, BESIDE);
    expect(s.provider.embedded.length).toBe(embedded);
    s.state.background = true;
    await s.sources.search("küche", QUERY);
    expect(s.provider.embedded.length).toBeGreaterThan(embedded);
  });

  it("brings the stored items up to date after Recommended answered, where it may run", async () => {
    const s = setup();
    s.register();
    await s.sources.search("küche", QUERY);
    s.listed.push({ id: "c3", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    s.pythia.notify();
    const first = await s.sources.relatedToVectors(KITCHEN, BESIDE);
    expect(ids(first)).not.toContain(key("c3"));
    await vi.waitFor(() => expect(s.provider.embedded).toContain("küche neu"));
    await vi.waitFor(async () =>
      expect(ids(await s.sources.relatedToVectors(KITCHEN, BESIDE))).toContain(key("c3"))
    );
  });

  it("is not asked on a phone for changed items before a search answers", async () => {
    const s = setup({
      [FILE("pythia")]: serializeIndex([{ id: "c1", contentHash: "x", chunks: KITCHEN }], 4)
    });
    s.state.background = false;
    s.state.phone = true;
    s.register();
    s.listed.push({ id: "c3", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    expect(ids(await s.sources.search("küche", QUERY))).toEqual([key("c1")]);
    expect(s.provider.embedded).toEqual(["küche"]);
  });

  it("reads a query once when the vault's vector for it is at hand", async () => {
    const s = setup();
    s.register();
    await s.sources.search("küche", QUERY);
    s.provider.embedded = [];
    s.state.vector = new Int8Array([127, 0, 0, 0]);
    expect(ids(await s.sources.search("anything", QUERY))).toEqual([key("c1")]);
    expect(s.provider.embedded).toEqual([]);
  });

  it("serves two searches at once from one sync", async () => {
    const s = setup();
    s.register();
    const [a, b] = await Promise.all([
      s.sources.search("küche", QUERY),
      s.sources.search("küche", QUERY)
    ]);
    expect(ids(a)).toEqual([key("c1")]);
    expect(ids(b)).toEqual([key("c1")]);
    expect(s.pythia.raw.list).toHaveBeenCalledTimes(1);
  });
});

describe("an item's own vectors", () => {
  it("find the items like it, itself left out", async () => {
    const s = setup();
    s.listed.push({ id: "c3", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    s.register();
    await s.sources.search("küche", QUERY);
    const vectors = await s.sources.vectorsOf(key("c1"));
    expect(vectors).not.toBeNull();
    const found = await s.sources.relatedToVectors(vectors!, { ...BESIDE, excludeKey: key("c1") });
    expect(ids(found)).toEqual([key("c3")]);
  });
});
