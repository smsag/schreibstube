import { describe, expect, it } from "vitest";
import { recommendNotes } from "./recommend";
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
