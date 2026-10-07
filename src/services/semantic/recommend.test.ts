import { describe, expect, it } from "vitest";
import { itemKey } from "./semantic-api";
import {
  foldDescriptions,
  meaningOrder,
  recommendNotes,
  relevanceOf,
  similarityPercent,
  withAttached,
  type RecommendReason,
  withoutShown
} from "./recommend";
import type { RelatedReason } from "../related-notes";

const g = (path: string, ...reasons: RelatedReason[]) => ({ path, reasons });
/** Found by meaning, best first, each a little less alike than the one before. */
const m = (...paths: string[]) => paths.map((path, i) => ({ path, score: 0.8 - i / 100 }));
const link: RelatedReason = { kind: "link", count: 1 };
const tag: RelatedReason = { kind: "tag", count: 1 };

describe("recommendNotes", () => {
  it("gives a link either way the same lead over what meaning found first", () => {
    const backlink: RelatedReason = { kind: "backlink", count: 1 };
    const byLink = recommendNotes([g("a.md", link)], m("x.md"), 10);
    const byBacklink = recommendNotes([g("a.md", backlink)], m("x.md"), 10);
    expect(byBacklink.map((r) => r.path)).toEqual(["a.md", "x.md"]);
    expect(byBacklink[0]?.score).toBe(byLink[0]?.score);
  });

  it("adds what only meaning found — the note nobody linked", () => {
    const out = recommendNotes([g("linked.md", link)], m("same-kitchen.md"), 10);
    expect(out.map((r) => r.path)).toEqual(["linked.md", "same-kitchen.md"]);
    expect(out[1]?.reasons).toEqual([{ kind: "meaning", count: 1, similarity: 0.8 }]);
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

  it("puts the note that reads most alike above one the graph knows only by its tags", () => {
    const out = recommendNotes([g("tagged.md", tag)], m("alike.md"), 10);
    expect(out.map((r) => r.path)).toEqual(["alike.md", "tagged.md"]);
  });

  it("lets only the first few notes known by tags alone into the list", () => {
    const tagged = Array.from({ length: 8 }, (_, i) => g(`t${i}.md`, tag));
    const out = recommendNotes([...tagged, g("linked.md", link)], [], 20);
    expect(out.map((r) => r.path)).toEqual([
      "linked.md",
      "t0.md",
      "t1.md",
      "t2.md",
      "t3.md",
      "t4.md"
    ]);
  });

  it("still counts tags in full beside a link", () => {
    const both = recommendNotes([g("both.md", link, tag), g("plain.md", tag)], [], 10);
    expect(both[0]?.reasons.map((r) => r.kind)).toEqual(["link", "tag"]);
  });

  it("is empty when neither side found anything", () => {
    expect(recommendNotes([], [], 5)).toEqual([]);
  });
});

const key = (id: string) => itemKey("pythia", id);
const vault = (hits: { key: string; score: number }[], floor = 0.5) => ({ hits, floor });
const items = (hits: { id: string; score: number }[], floor = 0.5) => ({
  hits: hits.map((hit) => ({ key: key(hit.id), score: hit.score })),
  floor
});

describe("meaningOrder", () => {
  it("ranks notes, pictures and items together", () => {
    const order = meaningOrder(
      vault([
        { key: "a.md", score: 0.8 },
        { key: "bild.jpg", score: 0.6 }
      ]),
      items([{ id: "c1", score: 0.7 }])
    );
    expect(order.map((hit) => hit.path)).toEqual(["a.md", key("c1"), "bild.jpg"]);
  });

  it("reads each kind against its own floor, and keeps the raw similarity", () => {
    // A note barely past its floor below an item well past its own.
    const order = meaningOrder(
      vault([{ key: "a.md", score: 0.66 }], 0.65),
      items([{ id: "c1", score: 0.64 }], 0.57)
    );
    expect(order).toEqual([
      { path: key("c1"), score: 0.64 },
      { path: "a.md", score: 0.66 }
    ]);
  });

  it("keeps the vault first on a tie", () => {
    const order = meaningOrder(
      vault([{ key: "a.md", score: 0.6 }]),
      items([{ id: "c1", score: 0.6 }])
    );
    expect(order[0]?.path).toBe("a.md");
  });

  it("lists a picture found through two description notes once", () => {
    const order = meaningOrder(
      vault([
        { key: "bild.jpg", score: 0.9 },
        { key: "bild.jpg", score: 0.6 }
      ]),
      items([])
    );
    expect(order).toEqual([{ path: "bild.jpg", score: 0.9 }]);
  });
});

describe("one list across kinds", () => {
  it("fuses a conversation with the link graph and stops at the count", () => {
    const meaning = meaningOrder(
      vault([{ key: "prose.md", score: 0.55 }]),
      items([{ id: "c1", score: 0.9 }])
    );
    const out = recommendNotes([g("linked.md", link), g("tagged.md", tag)], meaning, 2);
    expect(out.map((r) => r.path)).toEqual(["linked.md", key("c1")]);
  });
});

describe("withAttached", () => {
  const attached = (path: string) => ({ path, reasons: [{ kind: "attached", count: 1 }] });

  it("places an attached conversation after the last linked note", () => {
    const out = withAttached([g("linked.md", link), g("tagged.md", tag)], [key("c1")]);
    expect(out).toEqual([g("linked.md", link), attached(key("c1")), g("tagged.md", tag)]);
  });

  it("puts it first when nothing is linked", () => {
    const out = withAttached([g("tagged.md", tag)], [key("c1")]);
    expect(out[0]?.path).toBe(key("c1"));
  });

  it("lets an attached conversation outrank one only found by meaning", () => {
    const ranked = recommendNotes(
      withAttached([g("tagged.md", tag)], [key("attached")]),
      [{ path: key("alike"), score: 0.9 }],
      10
    );
    expect(ranked[0]?.path).toBe(key("attached"));
    expect(ranked[0]?.reasons[0]?.kind).toBe("attached");
  });
});

describe("relevanceOf", () => {
  const floors = { balanced: 0.62, strict: 0.66 };
  const meaning = (similarity: number): RecommendReason => ({
    kind: "meaning",
    count: 1,
    similarity
  });

  it("calls what a person said high", () => {
    expect(relevanceOf([link], floors)).toBe("high");
    expect(relevanceOf([{ kind: "backlink", count: 1 }], floors)).toBe("high");
    expect(relevanceOf([{ kind: "attached", count: 1 }], floors)).toBe("high");
  });

  it("reads similarity against the model's floors", () => {
    expect(relevanceOf([meaning(0.7)], floors)).toBe("high");
    expect(relevanceOf([meaning(0.64)], floors)).toBe("medium");
    expect(relevanceOf([meaning(0.62)], floors)).toBe("low");
  });

  it("adds evidence up: a hint and a weak likeness are more than either", () => {
    expect(relevanceOf([tag], floors)).toBe("low");
    expect(relevanceOf([tag, meaning(0.62)], floors)).toBe("medium");
    expect(relevanceOf([{ kind: "shared-link", count: 1 }, tag], floors)).toBe("high");
  });

  it("gives the folder nothing", () => {
    expect(relevanceOf([{ kind: "folder", count: 1 }], floors)).toBe("low");
  });
});

describe("similarityPercent", () => {
  it("rounds and bounds", () => {
    expect(similarityPercent(0.784)).toBe(78);
    expect(similarityPercent(1.2)).toBe(100);
    expect(similarityPercent(-0.1)).toBe(0);
  });
});

describe("foldDescriptions", () => {
  const pictureOf = (path: string) =>
    path === "Beschreibungen/see.md" || path === "Beschreibungen/see 2.md"
      ? "Bilder/see.jpg"
      : null;

  it("lists a description note as its picture, with the note's reasons", () => {
    const out = foldDescriptions(
      [g("a.md", link), g("Beschreibungen/see.md", { kind: "shared-link", count: 2 })],
      pictureOf
    );
    expect(out).toEqual([
      { path: "a.md", reasons: [link], picture: false },
      { path: "Bilder/see.jpg", reasons: [{ kind: "shared-link", count: 2 }], picture: true }
    ]);
  });

  it("makes one entry of two notes describing one picture, where the first stood", () => {
    const out = foldDescriptions(
      [
        g("Beschreibungen/see.md", tag),
        g("b.md", link),
        g("Beschreibungen/see 2.md", { kind: "tag", count: 3 }, link)
      ],
      pictureOf
    );
    expect(out.map((entry) => entry.path)).toEqual(["Bilder/see.jpg", "b.md"]);
    expect(out[0]?.reasons).toEqual([{ kind: "tag", count: 3 }, link]);
  });

  it("does not change the reasons it was handed", () => {
    const shared = { kind: "tag", count: 1 } as RelatedReason;
    foldDescriptions(
      [g("Beschreibungen/see.md", shared), g("Beschreibungen/see 2.md", { kind: "tag", count: 4 })],
      pictureOf
    );
    expect(shared.count).toBe(1);
  });
});

describe("withoutShown", () => {
  const entries = [
    { path: "Bilder/kueche.jpg", picture: true },
    { path: "Bilder/bad.jpg", picture: true },
    { path: "Notizen/Objekt 12.md", picture: false }
  ];

  it("leaves out the pictures the note shows itself, and keeps the notes it links", () => {
    const shown = new Set(["Bilder/kueche.jpg", "Notizen/Objekt 12.md"]);
    expect(withoutShown(entries, (entry) => entry.picture, shown)).toEqual([
      { path: "Bilder/bad.jpg", picture: true },
      { path: "Notizen/Objekt 12.md", picture: false }
    ]);
  });

  it("keeps every entry for a note that shows no picture", () => {
    expect(withoutShown(entries, (entry) => entry.picture, new Set())).toHaveLength(3);
  });

  it("leaves out the notes it links as well, under the note", () => {
    const shown = new Set(["Bilder/kueche.jpg", "Notizen/Objekt 12.md"]);
    expect(withoutShown(entries, (entry) => entry.picture, shown, true)).toEqual([
      { path: "Bilder/bad.jpg", picture: true }
    ]);
  });
});
