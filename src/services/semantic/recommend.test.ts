import { describe, expect, it } from "vitest";
import { conversationIdOf, conversationKey, meaningOrder, recommendNotes } from "./recommend";
import type { RelatedReason } from "../related-notes";

const g = (path: string, ...reasons: RelatedReason[]) => ({ path, reasons });
const m = (...paths: string[]) => paths.map((path) => ({ path }));
const link: RelatedReason = { kind: "link", count: 1 };
const tag: RelatedReason = { kind: "tag", count: 1 };

describe("recommendNotes", () => {
  it("adds what only meaning found — the note nobody linked", () => {
    const out = recommendNotes([g("linked.md", link)], m("same-kitchen.md"), 10);
    expect(out.map((r) => r.path)).toEqual(["linked.md", "same-kitchen.md"]);
    expect(out[1]?.reasons).toEqual([{ kind: "meaning", count: 1 }]);
  });

  it("keeps a direct link above a note that is only first by meaning", () => {
    const out = recommendNotes([g("tagged.md", tag), g("linked.md", link)], m("prose.md"), 10);
    expect(out[0]?.path).toBe("linked.md");
  });

  it("raises a note both find, and lists its reasons strongest first", () => {
    const out = recommendNotes([g("a.md", tag), g("b.md", tag)], m("c.md", "b.md"), 10);
    expect(out[0]?.path).toBe("b.md");
    expect(out[0]?.reasons.map((r) => r.kind)).toEqual(["meaning", "tag"]);
  });

  it("caps the list", () => {
    expect(recommendNotes([g("a.md", tag)], m("b.md", "c.md"), 2)).toHaveLength(2);
  });

  it("is empty when neither side found anything", () => {
    expect(recommendNotes([], [], 5)).toEqual([]);
  });
});

describe("meaningOrder", () => {
  it("ranks notes, pictures and conversations together by score", () => {
    const order = meaningOrder(
      [
        { key: "a.md", score: 0.8 },
        { key: "bild.jpg", score: 0.5 }
      ],
      [{ id: "c1", score: 0.7 }]
    );
    expect(order.map((hit) => hit.path)).toEqual(["a.md", conversationKey("c1"), "bild.jpg"]);
  });

  it("keeps the vault first on a tie", () => {
    const order = meaningOrder([{ key: "a.md", score: 0.6 }], [{ id: "c1", score: 0.6 }]);
    expect(order[0]?.path).toBe("a.md");
  });

  it("lists a picture found through two description notes once", () => {
    const order = meaningOrder(
      [
        { key: "bild.jpg", score: 0.9 },
        { key: "bild.jpg", score: 0.4 }
      ],
      []
    );
    expect(order).toEqual([{ path: "bild.jpg" }]);
  });
});

describe("conversation keys", () => {
  it("round-trip, and a vault path is never one", () => {
    expect(conversationIdOf(conversationKey("9d66b8f5"))).toBe("9d66b8f5");
    expect(conversationIdOf("Docs/Notiz.md")).toBeNull();
  });
});

describe("one list across kinds", () => {
  it("fuses a conversation with the link graph and stops at the count", () => {
    const meaning = meaningOrder([{ key: "prose.md", score: 0.5 }], [{ id: "c1", score: 0.9 }]);
    const out = recommendNotes([g("linked.md", link), g("tagged.md", tag)], meaning, 2);
    expect(out.map((r) => r.path)).toEqual(["linked.md", conversationKey("c1")]);
  });
});
