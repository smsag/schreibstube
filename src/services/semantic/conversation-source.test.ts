import { describe, expect, it } from "vitest";
import {
  MAX_CONTEXT_NOTES,
  MAX_CONVERSATION_CHARS,
  MAX_CONVERSATIONS,
  MAX_MESSAGES,
  conversationChunks,
  normalizeConversation,
  normalizeConversations
} from "./conversation-source";

const conv = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  title: "Exposé Seestraße",
  updatedAt: 10,
  summary: "Texte für das Exposé",
  messages: ["Schreib einen Text", "Hier ist er"],
  ...over
});

describe("normalizeConversation", () => {
  it("takes a well-formed entry as it is", () => {
    expect(normalizeConversation(conv())).toEqual({
      id: "c1",
      title: "Exposé Seestraße",
      updatedAt: 10,
      summary: "Texte für das Exposé",
      messages: ["Schreib einen Text", "Hier ist er"],
      notes: []
    });
  });

  it("refuses an entry without a usable id", () => {
    expect(normalizeConversation(conv({ id: "" }))).toBeNull();
    expect(normalizeConversation(conv({ id: 7 }))).toBeNull();
    expect(normalizeConversation(conv({ id: "x".repeat(201) }))).toBeNull();
    expect(normalizeConversation("c1")).toBeNull();
  });

  it("coerces what is not text or not a number", () => {
    const item = normalizeConversation(
      conv({ title: 3, summary: null, updatedAt: "x", messages: [null, "a", 5] })
    );
    expect(item).toEqual({
      id: "c1",
      title: "",
      updatedAt: 0,
      summary: "",
      messages: ["a"],
      notes: []
    });
  });

  it("looks at a bounded number of messages, whatever their text", () => {
    const messages = Array.from({ length: MAX_MESSAGES + 10 }, () => "");
    messages[MAX_MESSAGES + 5] = "seen too late";
    messages[MAX_MESSAGES - 1] = "seen";
    expect(normalizeConversation(conv({ messages }))?.messages).toEqual(["seen"]);
  });

  it("bounds the text a conversation brings", () => {
    const item = normalizeConversation(conv({ messages: Array(10).fill("y".repeat(10_000)) }));
    const total =
      (item?.title.length ?? 0) +
      (item?.summary.length ?? 0) +
      (item?.messages.reduce((n, m) => n + m.length, 0) ?? 0);
    expect(total).toBe(MAX_CONVERSATION_CHARS);
  });
});

describe("the notes attached to a conversation", () => {
  it("are read as paths, once each", () => {
    const item = normalizeConversation(
      conv({ notes: ["Projekte/Pythia/readme.md", " Projekte/Pythia/readme.md ", "B.md"] })
    );
    expect(item?.notes).toEqual(["Projekte/Pythia/readme.md", "B.md"]);
  });

  it("drop what is not a path, and a list that is not a list", () => {
    expect(
      normalizeConversation(conv({ notes: [7, null, "", "x".repeat(1001), "A.md"] }))?.notes
    ).toEqual(["A.md"]);
    expect(normalizeConversation(conv({ notes: "A.md" }))?.notes).toEqual([]);
  });

  it("are bounded", () => {
    const notes = Array.from({ length: MAX_CONTEXT_NOTES + 5 }, (_, i) => `N${i}.md`);
    expect(normalizeConversation(conv({ notes }))?.notes).toHaveLength(MAX_CONTEXT_NOTES);
  });

  it("are not read to the end of a list that is mostly not paths", () => {
    const junk = Array.from({ length: MAX_CONTEXT_NOTES * 4 }, () => 7);
    expect(normalizeConversation(conv({ notes: [...junk, "A.md"] }))?.notes).toEqual([]);
    expect(normalizeConversation(conv({ notes: [...junk.slice(1), "A.md"] }))?.notes).toEqual([
      "A.md"
    ]);
  });

  it("leave the embedded text, and so the chunks, as they were", () => {
    const plain = normalizeConversation(conv());
    const attached = normalizeConversation(conv({ notes: ["A.md"] }));
    expect(conversationChunks(attached!)).toEqual(conversationChunks(plain!));
  });
});

describe("normalizeConversations", () => {
  it("keeps one per id, newest first, capped", () => {
    const list = [
      ...Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, i) =>
        conv({ id: `c${i}`, updatedAt: i })
      ),
      conv({ id: "c500", title: "Duplikat" })
    ];
    const out = normalizeConversations(list);
    expect(out).toHaveLength(MAX_CONVERSATIONS);
    expect(out[0]?.id).toBe(`c${MAX_CONVERSATIONS + 4}`);
    expect(out.find((c) => c.id === "c500")?.title).toBe("Exposé Seestraße");
  });

  it("reads anything that is not a list as nothing", () => {
    expect(normalizeConversations({})).toEqual([]);
  });
});

describe("conversationChunks", () => {
  it("leads with title and summary, then packs the messages", () => {
    const item = normalizeConversation(conv());
    expect(item && conversationChunks(item)).toEqual([
      "Exposé Seestraße. Texte für das Exposé",
      "Schreib einen Text\nHier ist er"
    ]);
  });

  it("splits a message longer than a chunk", () => {
    const item = normalizeConversation(
      conv({ summary: "", title: "", messages: ["z".repeat(1200)] })
    );
    expect(item && conversationChunks(item, 500).map((c) => c.length)).toEqual([500, 500, 200]);
  });

  it("always yields a chunk", () => {
    const item = normalizeConversation(conv({ title: "", summary: "", messages: [] }));
    expect(item && conversationChunks(item)).toEqual(["c1"]);
  });
});
