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
  const touched: string[] = [];
  const plugin = {
    app: {
      vault: {
        configDir: ".obsidian",
        adapter: {
          exists: async (p: string) => {
            touched.push(p);
            return disk.has(p) || p === ".obsidian/plugins/schreibstube";
          },
          readBinary: async (p: string) => {
            touched.push(p);
            return disk.get(p) ?? new ArrayBuffer(0);
          },
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
  const changed = vi.fn();
  const conversations = new SemanticConversations({
    plugin,
    logger: NULL_LOGGER,
    enabled: () => state.enabled,
    modelId: () => "xenova-paraphrase-multilingual-MiniLM-L12-v2",
    provider: () => provider,
    changed,
    mayEmbedInBackground: () => state.background,
    queryVector: async () => state.vector
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
  return {
    conversations,
    provider,
    source,
    listed,
    notify: () => notify(),
    state,
    disk,
    changed,
    touched
  };
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

  // Pythia's files predate the runtime mark on every row, so a copy would only
  // be embedded again; Pythia removes them itself.
  it("leaves Pythia's old conversation index alone", async () => {
    const s = setup({
      ".obsidian/plugins/pythia/related-embeddings-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin":
        serializeIndex([], 4)
    });
    s.conversations.register(s.source);
    await s.conversations.search("küche", 5, []);
    expect(s.touched.length).toBeGreaterThan(0);
    expect(s.touched.filter((p) => p.startsWith(".obsidian/plugins/pythia/"))).toEqual([]);
  });

  it("names a conversation by the title its source gave", async () => {
    const s = setup();
    s.listed[0]!.title = "Exposé";
    s.conversations.register(s.source);
    await s.conversations.search("küche", 5, []);
    expect(s.conversations.titleOf("c1")).toBe("Exposé");
    // Unknown is said as such, so the panel can name it rather than show an id.
    expect(s.conversations.titleOf("unknown")).toBeNull();
    expect(s.conversations.titleOf("c2")).toBeNull(); // listed, but without a title
  });

  it("knows the titles beside a note without a search and without the model", async () => {
    const s = setup();
    s.listed[0]!.title = "Exposé";
    s.conversations.register(s.source);
    await s.conversations.relatedToVectors([new Int8Array([127, 0, 0, 0])], 5);
    expect(s.conversations.titleOf("c1")).toBe("Exposé");
    expect(s.provider.embedded).toHaveLength(0);
  });
});

describe("conversations beside a note", () => {
  it("answer from what is stored, without embedding a changed conversation", async () => {
    const s = setup();
    s.conversations.register(s.source);
    await s.conversations.search("küche", 5, []); // the index is built once
    const embedded = s.provider.embedded.length;
    s.listed.push({ id: "c3", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    s.notify();
    s.state.background = false;
    await s.conversations.relatedToVectors([new Int8Array([127, 0, 0, 0])], 5);
    expect(s.provider.embedded.length).toBe(embedded); // no model for the panel
    s.state.background = true;
    await s.conversations.search("küche", 5, []); // a search does bring it up to date
    expect(s.provider.embedded.length).toBeGreaterThan(embedded);
  });
});

describe("a search on a phone", () => {
  it("answers from what is stored rather than embedding every changed conversation first", async () => {
    const s = setup();
    s.state.background = false;
    s.conversations.register(s.source);
    // The desktop's index, as sync delivered it.
    s.disk.set(
      ".obsidian/plugins/schreibstube/semantic-conversations-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin",
      serializeIndex([{ id: "c1", contentHash: "x", chunks: [new Int8Array([127, 0, 0, 0])] }], 4)
    );
    s.listed.push({ id: "c3", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    const found = await s.conversations.search("küche", 5, []);
    expect(found.map((hit) => hit.id)).toEqual(["c1"]);
    // The query was embedded; no conversation was.
    expect(s.provider.embedded).toEqual(["küche"]);
  });
});

describe("two searches at once", () => {
  it("both wait for the one sync, rather than the second asking a half-filled index", async () => {
    const s = setup();
    s.conversations.register(s.source);
    const [first, second] = await Promise.all([
      s.conversations.search("küche", 5, []),
      s.conversations.search("küche", 5, [])
    ]);
    expect(first.map((hit) => hit.id)).toEqual(["c1"]);
    expect(second.map((hit) => hit.id)).toEqual(["c1"]);
    expect(s.source.list).toHaveBeenCalledTimes(1);
  });

  it("rank the vault search's vector when the engine has one, embedding the text once", async () => {
    const s = setup();
    s.conversations.register(s.source);
    await s.conversations.search("küche", 5, []);
    s.provider.embedded = [];
    s.state.vector = new Int8Array([127, 0, 0, 0]);
    expect((await s.conversations.search("anything", 5, [])).map((hit) => hit.id)).toEqual(["c1"]);
    expect(s.provider.embedded).toEqual([]);
  });
});

describe("conversations beside a note, where the model may run", () => {
  it("brings the stored conversations up to date after answering", async () => {
    const s = setup();
    s.conversations.register(s.source);
    await s.conversations.search("küche", 5, []);
    s.listed.push({ id: "c3", title: "", updatedAt: 3, summary: "", messages: ["küche neu"] });
    s.notify();

    const first = await s.conversations.relatedToVectors([new Int8Array([127, 0, 0, 0])], 5);
    // Answered from what was stored: the new conversation is not in it yet.
    expect(first.map((hit) => hit.id)).not.toContain("c3");

    await vi.waitFor(() => expect(s.provider.embedded).toContain("küche neu"));
    await vi.waitFor(() => expect(s.changed).toHaveBeenCalled());
    const next = await s.conversations.relatedToVectors([new Int8Array([127, 0, 0, 0])], 5);
    expect(next.map((hit) => hit.id)).toContain("c3");
  });

  it("starts nothing when nothing changed", async () => {
    const s = setup();
    s.conversations.register(s.source);
    await s.conversations.search("küche", 5, []);
    const embedded = s.provider.embedded.length;

    await s.conversations.relatedToVectors([new Int8Array([127, 0, 0, 0])], 5);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(s.provider.embedded.length).toBe(embedded);
    expect(s.source.list).toHaveBeenCalledTimes(1);
  });
});

describe("the notes attached to a conversation", () => {
  it("name the conversations a note was attached to, from the listing", async () => {
    const s = setup();
    (s.listed[0] as Record<string, unknown>).notes = ["Projekte/Pythia/readme.md"];
    s.conversations.register(s.source);
    await s.conversations.relatedToVectors([new Int8Array([127, 0, 0, 0])], 5);

    expect(s.conversations.attachedTo("Projekte/Pythia/readme.md")).toEqual(["c1"]);
    expect(s.conversations.attachedTo("Anderes.md")).toEqual([]);
  });
});

describe("the floor beside a note", () => {
  it("is the one measured for a note against a conversation", async () => {
    const s = setup();
    s.conversations.register(s.source);
    await s.conversations.search("küche", 5, []);
    // Between the note floor (0.62) and the conversation floor (0.65).
    const vector = new Int8Array([81, 98, 0, 0]); // cosine 0.638 against c1
    const found = await s.conversations.relatedToVectors([vector], 5);
    expect(found.map((hit) => hit.id)).toContain("c1");
  });
});
