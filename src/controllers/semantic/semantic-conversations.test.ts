import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";
import { SemanticConversations } from "./semantic-conversations";
import type { EmbeddingProvider } from "../../services/semantic/embedding-provider";
import { NULL_LOGGER } from "../../services/logger";
import { serializeIndex } from "../../services/semantic/embedding-index";

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
          mkdir: async () => undefined
        }
      }
    },
    manifest: { id: "schreibstube", dir: ".obsidian/plugins/schreibstube" }
  } as unknown as Plugin;
  const provider = new FakeProvider();
  const state = { enabled: true };
  const changed = vi.fn();
  const conversations = new SemanticConversations({
    plugin,
    logger: NULL_LOGGER,
    enabled: () => state.enabled,
    modelId: () => "xenova-paraphrase-multilingual-MiniLM-L12-v2",
    provider: () => provider,
    changed
  });
  let notify: () => void = () => undefined;
  const listed = [
    { id: "c1", title: "", updatedAt: 2, summary: "", messages: ["die küche"] },
    { id: "c2", title: "", updatedAt: 1, summary: "", messages: ["der garten"] }
  ];
  const source = {
    list: vi.fn(() => listed),
    onChanged: (cb: () => void) => {
      notify = cb;
      return () => undefined;
    }
  };
  return { conversations, provider, source, listed, notify: () => notify(), state, disk, changed };
}

// The list deadline sets a timer on `window`, which a node test does not have.
vi.stubGlobal("window", globalThis);

describe("conversations handed over", () => {
  it("answers nothing without a source", async () => {
    const { conversations } = setup();
    expect(await conversations.search("küche", 5, [])).toEqual([]);
  });

  it("lists the source once, and again only after it said something changed", async () => {
    const s = setup();
    s.conversations.register(s.source);

    expect((await s.conversations.search("küche", 5, [])).map((h) => h.id)).toEqual(["c1"]);
    await s.conversations.search("küche", 5, []);
    expect(s.source.list).toHaveBeenCalledTimes(1);

    s.listed.push({ id: "c3", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    s.notify();
    expect((await s.conversations.search("küche", 5, [])).map((h) => h.id).sort()).toEqual([
      "c1",
      "c3"
    ]);
    expect(s.source.list).toHaveBeenCalledTimes(2);
  });

  it("answers nothing while search by meaning is off", async () => {
    const s = setup();
    s.conversations.register(s.source);
    s.state.enabled = false;
    expect(await s.conversations.related("c1", 5)).toEqual([]);
    expect(s.source.list).not.toHaveBeenCalled();
  });

  it("stops asking a source it let go of", async () => {
    const s = setup();
    const release = s.conversations.register(s.source);
    release();
    expect(await s.conversations.search("küche", 5, [])).toEqual([]);
  });

  it("takes over Pythia's conversation index", async () => {
    const pythia = serializeIndex([], 4);
    const s = setup({
      ".obsidian/plugins/pythia/related-embeddings-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin":
        pythia
    });
    s.conversations.register(s.source);
    await s.conversations.search("küche", 5, []);
    expect(
      s.disk.has(
        ".obsidian/plugins/schreibstube/semantic-conversations-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin"
      )
    ).toBe(true);
  });

  it("names a conversation by the title its source gave", async () => {
    const s = setup();
    s.listed[0]!.title = "Exposé";
    s.conversations.register(s.source);
    await s.conversations.search("küche", 5, []);
    expect(s.conversations.titleOf("c1")).toBe("Exposé");
    expect(s.conversations.titleOf("unknown")).toBe("unknown");
  });
});
