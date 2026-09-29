import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";
import { SemanticSources } from "./semantic-sources";
import type { EmbeddingProvider } from "../../services/semantic/embedding-provider";
import { NULL_LOGGER } from "../../services/logger";
import { serializeIndex } from "../../services/semantic/embedding-index";
import {
  MAX_SOURCES,
  itemKey,
  readSource,
  type SourceConsent
} from "../../services/semantic/semantic-api";

class FakeProvider implements EmbeddingProvider {
  readonly dim = 4;
  embedded: string[] = [];
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
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
          readBinary: async (p: string) => disk.get(p) ?? new ArrayBuffer(0),
          writeBinary: async (p: string, b: ArrayBuffer) => void disk.set(p, b),
          rename: async (from: string, to: string) => {
            disk.set(to, disk.get(from)!);
            disk.delete(from);
          },
          remove: async (p: string) => void disk.delete(p),
          mkdir: async () => undefined
        }
      }
    },
    manifest: { id: "schreibstube", dir: ".obsidian/plugins/schreibstube" }
  } as unknown as Plugin;
  const provider = new FakeProvider();
  /** `background`: a desktop with nothing else running; false is a phone. */
  const state = { enabled: true, background: true, vector: null as Int8Array | null };
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
    queryVector: async () => state.vector,
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
    s.sources.consentChanged();
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

describe("a source that says what changed", () => {
  it("is asked for the changed items alone after the first listing", async () => {
    const s = setup();
    const items: Item[] = [
      { id: "a", title: "", updatedAt: 1, summary: "", messages: ["küche"] },
      { id: "b", title: "", updatedAt: 2, summary: "", messages: ["garten"] }
    ];
    const current = new Set(["a", "b"]);
    const changedSince = vi.fn((since: number) => items.filter((i) => i.updatedAt > since));
    const incremental = s.makeSource(items, { ids: () => [...current], changedSince });
    s.register("pythia", incremental);
    await s.sources.search("küche", QUERY);
    expect(incremental.raw.list).toHaveBeenCalledTimes(1);

    items.push({ id: "c", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    current.add("c");
    current.delete("a");
    incremental.notify();
    const found = ids(await s.sources.search("küche", QUERY));
    expect(changedSince).toHaveBeenCalledWith(2);
    expect(incremental.raw.list).toHaveBeenCalledTimes(1);
    expect(found).toEqual([key("c")]);
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
