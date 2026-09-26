import { describe, expect, it, vi } from "vitest";
import { createSemanticApi } from "./semantic-api";
import type { SemanticEngine } from "./semantic-engine";
import { NULL_LOGGER } from "../../services/logger";

function fakeEngine(over: Partial<Record<string, unknown>> = {}) {
  const conversations = {
    search: vi.fn(async () => [{ id: "c1", score: 0.6 }]),
    related: vi.fn(async () => [{ id: "c2", score: 0.8 }]),
    register: vi.fn(() => () => undefined),
    titleOf: (id: string) => `Titel ${id}`
  };
  const engine = {
    enabled: () => true,
    search: vi.fn(async () => [
      { id: "Notizen/küche.md", score: 0.7 },
      { id: "Bildbeschreibungen/see.md", score: 0.5 },
      { id: "gone.md", score: 0.4 }
    ]),
    onChange: vi.fn(() => () => undefined),
    conversations,
    ...over
  } as unknown as SemanticEngine;
  return { engine, conversations };
}

const vaultHit = (path: string) =>
  path === "gone.md"
    ? null
    : path.startsWith("Bildbeschreibungen/")
      ? { kind: "image" as const, id: "Bilder/see.jpg", title: "see" }
      : { kind: "note" as const, id: path, title: "Küche" };

describe("the semantic API", () => {
  it("answers notes, pictures and conversations in one list, best first", async () => {
    const { engine } = fakeEngine();
    const api = createSemanticApi({ engine, logger: NULL_LOGGER, vaultHit });

    const hits = await api.search("küche", { kinds: ["note", "image", "conversation"], limit: 10 });

    expect(hits.map((h) => [h.kind, h.id])).toEqual([
      ["note", "Notizen/küche.md"],
      ["conversation", "c1"],
      ["image", "Bilder/see.jpg"]
    ]);
    expect(hits[1]?.title).toBe("Titel c1");
  });

  it("gives only the kinds asked for, and leaves out excluded ids", async () => {
    const { engine, conversations } = fakeEngine();
    const api = createSemanticApi({ engine, logger: NULL_LOGGER, vaultHit });

    const hits = await api.search("küche", { kinds: ["image"], limit: 10, exclude: ["x"] });

    expect(hits.map((h) => h.id)).toEqual(["Bilder/see.jpg"]);
    expect(conversations.search).not.toHaveBeenCalled();
  });

  it("answers nothing for an empty text", async () => {
    const { engine } = fakeEngine();
    const api = createSemanticApi({ engine, logger: NULL_LOGGER, vaultHit });
    expect(await api.search("  ", { kinds: ["note"], limit: 5 })).toEqual([]);
  });

  it("answers nothing, rather than throwing, when a search fails", async () => {
    const { engine } = fakeEngine({
      search: vi.fn(async () => {
        throw new Error("model gone");
      })
    });
    const api = createSemanticApi({ engine, logger: NULL_LOGGER, vaultHit });
    expect(await api.search("küche", { kinds: ["note"], limit: 5 })).toEqual([]);
  });

  it("finds conversations like a conversation", async () => {
    const { engine, conversations } = fakeEngine();
    const api = createSemanticApi({ engine, logger: NULL_LOGGER, vaultHit });

    const hits = await api.related(
      { source: "pythia", id: "c1" },
      { kinds: ["conversation"], limit: 5 }
    );

    expect(hits).toEqual([{ kind: "conversation", id: "c2", title: "Titel c2", score: 0.8 }]);
    expect(conversations.related).toHaveBeenCalledWith("c1", 5);
  });

  it("does not yet answer related notes", async () => {
    const { engine } = fakeEngine();
    const api = createSemanticApi({ engine, logger: NULL_LOGGER, vaultHit });
    expect(
      await api.related({ path: "a.md" }, { kinds: ["note", "conversation"], limit: 5 })
    ).toEqual([]);
  });

  it("lets Pythia register a source and nobody else", () => {
    const { engine, conversations } = fakeEngine();
    const api = createSemanticApi({ engine, logger: NULL_LOGGER, vaultHit });
    const source = { list: () => [], onChanged: () => () => undefined };

    api.registerSource("pythia", source);

    expect(conversations.register).toHaveBeenCalledWith(source);
    expect(() => api.registerSource("someone-else", source)).toThrow(/may not register/);
    expect(() => api.registerSource("pythia", { list: [] } as never)).toThrow(/needs list/);
  });

  it("says whether it can answer", () => {
    const { engine } = fakeEngine({ enabled: () => false });
    const api = createSemanticApi({ engine, logger: NULL_LOGGER, vaultHit });
    expect(api.version).toBe(1);
    expect(api.ready()).toBe(false);
  });
});
