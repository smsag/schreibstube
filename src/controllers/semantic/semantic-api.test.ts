import { describe, expect, it, vi } from "vitest";
import { createSemanticApi, type SemanticApiDeps } from "./semantic-api";
import type { RelatedFound, SemanticEngine } from "./semantic-engine";
import { NULL_LOGGER } from "../../services/logger";
import {
  MAX_QUERY_CHARS,
  itemKey,
  relevance,
  type SourceDescriptor
} from "../../services/semantic/semantic-api";

const CONVERSATION: SourceDescriptor = {
  kind: "conversation",
  label: "Conversation in Pythia",
  plural: "Pythia conversations"
};
const HIGHLIGHT: SourceDescriptor = { kind: "highlight", label: "Highlight", plural: "Highlights" };

function fakeEngine(over: Partial<Record<string, unknown>> = {}) {
  const descriptors: Record<string, SourceDescriptor> = { pythia: CONVERSATION, reader: HIGHLIGHT };
  const sources = {
    descriptorOf: (id: string) => descriptors[id] ?? null,
    titleOf: (key: string) => `Titel ${key.split(":").pop()}`,
    kinds: () =>
      Object.entries(descriptors).map(([source, descriptor]) => ({ source, descriptor })),
    register: vi.fn(() => ({ release: () => undefined, consent: () => "pending" as const }))
  };
  const searchAll = vi.fn(async (text: string, opts: { notes: number; items: number }) => ({
    notes:
      opts.notes > 0
        ? [
            { id: "Notizen/küche.md", score: 0.7 },
            { id: "Bildbeschreibungen/see.md", score: 0.5 },
            { id: "gone.md", score: 0.4 }
          ]
        : [],
    notesFloor: 0.35,
    items: opts.items > 0 ? [{ key: itemKey("pythia", "c1"), score: 0.6 }] : [],
    itemsFloor: 0.35,
    text
  }));
  const related: RelatedFound = {
    notes: [
      { id: "Notizen/küche.md", score: 0.66 },
      { id: "Bildbeschreibungen/see.md", score: 0.9 },
      { id: "gone.md", score: 0.8 }
    ],
    notesFloor: 0.65,
    items: [
      { key: itemKey("pythia", "c1"), score: 0.64 },
      { key: itemKey("reader", "h1"), score: 0.6 }
    ],
    itemsFloor: 0.57
  };
  const engine = {
    enabled: () => true,
    searchState: () => "ready",
    searchAll,
    relatedToNote: vi.fn(async () => related),
    relatedToItem: vi.fn(async () => related),
    onContentChange: vi.fn(() => () => undefined),
    sources,
    ...over
  } as unknown as SemanticEngine;
  return { engine, sources, searchAll };
}

const vaultHit = (path: string) =>
  path === "gone.md"
    ? null
    : path.startsWith("Bildbeschreibungen/")
      ? { kind: "image" as const, id: "Bilder/see.jpg", title: "see" }
      : { kind: "note" as const, id: path, title: "Küche" };

function api(engine: SemanticEngine, over: Partial<SemanticApiDeps> = {}) {
  return createSemanticApi({
    engine,
    logger: NULL_LOGGER,
    vaultHit,
    isIcon: () => true,
    pluginPresent: () => true,
    ...over
  });
}

describe("a search", () => {
  it("answers notes, pictures and items in one list, most relevant first", async () => {
    const { engine } = fakeEngine();
    const hits = await api(engine).search("küche");
    expect(hits.map((h) => [h.kind, h.id])).toEqual([
      ["note", "Notizen/küche.md"],
      ["conversation", "pythia:c1"],
      ["image", "Bilder/see.jpg"]
    ]);
    expect(hits[1]).toMatchObject({
      source: "pythia",
      item: "c1",
      title: "Titel c1",
      similarity: 0.6
    });
  });

  it("gives only the kinds asked for, and asks no source when none is wanted", async () => {
    const { engine, searchAll } = fakeEngine();
    const hits = await api(engine).search("küche", { kinds: ["image"], limit: 10 });
    expect(hits.map((h) => h.id)).toEqual(["Bilder/see.jpg"]);
    expect(searchAll.mock.calls[0]?.[1]).toMatchObject({ items: 0 });
  });

  it("asks no source when an empty list of sources is given", async () => {
    const { engine, searchAll } = fakeEngine();
    await api(engine).search("küche", { sources: [] });
    expect(searchAll.mock.calls[0]?.[1]).toMatchObject({ items: 0 });
  });

  it("passes the sources asked for, and excluded items as keys", async () => {
    const { engine, searchAll } = fakeEngine();
    await api(engine).search("küche", { sources: ["reader"], exclude: ["pythia:c9", "a.md"] });
    const opts = searchAll.mock.calls[0]?.[1] as unknown as {
      sources: Set<string>;
      exclude: Set<string>;
    };
    expect([...opts.sources]).toEqual(["reader"]);
    expect([...opts.exclude]).toEqual([itemKey("pythia", "c9")]);
  });

  it("answers nothing for an empty text, and embeds at most a thousand characters", async () => {
    const { engine, searchAll } = fakeEngine();
    expect(await api(engine).search("  ")).toEqual([]);
    await api(engine).search(`${"k".repeat(2000)}  `);
    expect(searchAll.mock.calls[0]?.[0]).toHaveLength(MAX_QUERY_CHARS);
  });

  it("answers nothing, rather than throwing, when it fails", async () => {
    const { engine } = fakeEngine({
      searchAll: vi.fn(async () => {
        throw new Error("model gone");
      })
    });
    expect(await api(engine).search("küche")).toEqual([]);
  });
});

describe("what is related", () => {
  it("ranks each kind against its own floor, not by raw similarity", async () => {
    const { engine } = fakeEngine();
    const hits = await api(engine).related({ path: "a.md" });
    // The picture clears its floor by far; the conversation at 0.64 clears
    // 0.57 by more than the note at 0.66 clears 0.65.
    expect(hits.map((h) => h.id)).toEqual([
      "Bilder/see.jpg",
      "pythia:c1",
      "reader:h1",
      "Notizen/küche.md"
    ]);
    expect(hits[1]?.score).toBeCloseTo(relevance(0.64, 0.57));
  });

  it("finds what is like one of a source's items, by its key", async () => {
    const { engine } = fakeEngine();
    const hits = await api(engine).related(
      { source: "pythia", id: "c1" },
      { kinds: ["highlight"], limit: 5 }
    );
    expect(engine.relatedToItem).toHaveBeenCalledWith(itemKey("pythia", "c1"), 5, {
      notes: false,
      items: true,
      sources: null
    });
    expect(hits.map((h) => h.id)).toEqual(["reader:h1"]);
  });

  it("does not rank the vault when only a source's items are wanted", async () => {
    const { engine } = fakeEngine();
    await api(engine).related({ path: "a.md" }, { kinds: ["conversation"], sources: ["pythia"] });
    const scope = (engine.relatedToNote as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as {
      notes: boolean;
      items: boolean;
      sources: Set<string>;
    };
    expect(scope.notes).toBe(false);
    expect(scope.items).toBe(true);
    expect([...scope.sources]).toEqual(["pythia"]);
  });

  it("answers nothing for a source that could not be a plugin", async () => {
    const { engine } = fakeEngine();
    expect(await api(engine).related({ source: "Not A Plugin", id: "x" })).toEqual([]);
  });
});

describe("a source registering", () => {
  const source = {
    kind: "conversation",
    label: "Conversation in Pythia",
    plural: "Pythia conversations",
    list: () => [],
    onChanged: () => () => undefined
  };

  it("is taken from any enabled plugin, checked", () => {
    const { engine, sources } = fakeEngine();
    const registration = api(engine).registerSource("pythia", source);
    expect(sources.register).toHaveBeenCalledWith(
      "pythia",
      expect.objectContaining({ kind: "conversation" }),
      { kind: "conversation", label: "Conversation in Pythia", plural: "Pythia conversations" }
    );
    expect(registration.consent()).toBe("pending");
  });

  it("is refused under a name no enabled plugin has, or that is not a plugin id", () => {
    const { engine } = fakeEngine();
    expect(() =>
      api(engine, { pluginPresent: () => false }).registerSource("ghost", source)
    ).toThrow(/no enabled plugin/);
    expect(() => api(engine).registerSource("Not Valid", source)).toThrow(/not a plugin id/);
  });

  it("is taken when the registry cannot say who is enabled: the person decides", () => {
    const { engine, sources } = fakeEngine();
    api(engine, { pluginPresent: () => null }).registerSource("reader", source);
    expect(sources.register).toHaveBeenCalled();
  });

  it("is refused without what a source needs", () => {
    const { engine } = fakeEngine();
    expect(() => api(engine).registerSource("pythia", { ...source, kind: "note" })).toThrow(/kind/);
    expect(() => api(engine).registerSource("pythia", { list: [] } as never)).toThrow(/needs list/);
  });
});

describe("its state", () => {
  it("says how much it can answer", () => {
    expect(api(fakeEngine({ enabled: () => false }).engine).status()).toBe("off");
    expect(api(fakeEngine({ searchState: () => "none" }).engine).status()).toBe("loading");
    expect(api(fakeEngine({ searchState: () => "partial" }).engine).status()).toBe("partial");
    expect(api(fakeEngine().engine).version).toBe(2);
  });

  it("names the kinds a search can answer with", () => {
    const kinds = api(fakeEngine().engine).kinds();
    expect(kinds.map((k) => [k.kind, k.source])).toEqual([
      ["note", null],
      ["image", null],
      ["conversation", "pythia"],
      ["highlight", "reader"]
    ]);
    expect(kinds[2]).toMatchObject({
      label: "Conversation in Pythia",
      plural: "Pythia conversations"
    });
    expect(kinds.every((k) => k.label.length > 0 && k.plural.length > 0)).toBe(true);
  });

  it("tells of content changes through the engine's own event", () => {
    const { engine } = fakeEngine();
    const cb = vi.fn();
    api(engine).onIndexChanged(cb);
    expect(engine.onContentChange).toHaveBeenCalled();
  });
});
