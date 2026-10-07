import { describe, expect, it } from "vitest";
import {
  backlinkIndex,
  isRareTag,
  linkDegrees,
  rankRelated,
  RELATED_LIMIT,
  relatedTags,
  type RelatedSubject
} from "./related-notes";

function note(path: string, extra: Partial<RelatedSubject> = {}): RelatedSubject {
  return {
    path,
    links: [],
    backlinks: [],
    tags: [],
    folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    modifiedAt: 0,
    ...extra
  };
}

/**
 * A small vault shaped like a real one: an Objekt note listing two viewings,
 * an Exposé pointing at the same Objekt, and an unrelated contact.
 */
const VAULT: RelatedSubject[] = [
  note("Objekte/Objekt 12.md", {
    links: ["Termine/Besichtigung A.md", "Termine/Besichtigung B.md"],
    backlinks: ["Objekte/Exposé 12.md"],
    tags: ["objekt"]
  }),
  note("Objekte/Exposé 12.md", {
    links: ["Objekte/Objekt 12.md"],
    tags: ["objekt", "expose"]
  }),
  note("Termine/Besichtigung A.md", {
    backlinks: ["Objekte/Objekt 12.md"],
    tags: ["termin"]
  }),
  note("Termine/Besichtigung B.md", {
    backlinks: ["Objekte/Objekt 12.md"],
    tags: ["termin"]
  }),
  note("Kontakte/Meier.md", { tags: ["kontakt"] })
];

describe("rankRelated", () => {
  it("puts a note linked with the source first, here one that links to it", () => {
    const related = rankRelated("Objekte/Objekt 12.md", VAULT);

    expect(related[0]?.path).toBe("Objekte/Exposé 12.md");
    expect(related[0]?.reasons[0]?.kind).toBe("backlink");
  });

  it("names a link by its direction, and weighs both directions alike", () => {
    const vault: RelatedSubject[] = [
      note("Quelle.md", { links: ["Ziel.md", "Beide.md"], backlinks: ["Fan.md", "Beide.md"] }),
      note("Ziel.md", { backlinks: ["Quelle.md"] }),
      note("Fan.md", { links: ["Quelle.md"] }),
      note("Beide.md", { links: ["Quelle.md"], backlinks: ["Quelle.md"] })
    ];
    const related = rankRelated("Quelle.md", vault);
    const kind = (path: string) => related.find((entry) => entry.path === path)?.reasons[0]?.kind;
    const score = (path: string) => related.find((entry) => entry.path === path)?.score;

    expect(kind("Ziel.md")).toBe("link");
    expect(kind("Fan.md")).toBe("backlink");
    // Both ways is in this note's text, so it reads as a link from here, once.
    const both = related.find((entry) => entry.path === "Beide.md")?.reasons ?? [];
    expect(both.filter((reason) => reason.kind === "link" || reason.kind === "backlink")).toEqual([
      { kind: "link", count: 1 }
    ]);
    expect(score("Fan.md")).toBe(score("Ziel.md"));
    expect(score("Beide.md")).toBe(score("Ziel.md"));
  });

  it("finds siblings nothing links to each other by co-citation", () => {
    // The two viewings share no link, no tag with each other beyond "termin",
    // and no text — only the Objekt note that lists them both.
    const related = rankRelated("Termine/Besichtigung A.md", VAULT);

    expect(related[0]?.path).toBe("Termine/Besichtigung B.md");
    expect(related[0]?.reasons.map((reason) => reason.kind)).toContain("co-citation");
  });

  it("leaves out a note sharing nothing with the source", () => {
    const related = rankRelated("Termine/Besichtigung A.md", VAULT);

    expect(related.map((entry) => entry.path)).not.toContain("Kontakte/Meier.md");
  });

  it("never lists the source itself", () => {
    const related = rankRelated("Objekte/Objekt 12.md", VAULT);

    expect(related.map((entry) => entry.path)).not.toContain("Objekte/Objekt 12.md");
  });

  it("answers a note the vault does not hold with nothing", () => {
    expect(rankRelated("Nirgends.md", VAULT)).toEqual([]);
  });

  it("answers a note nobody linked, tagged or filed with nothing", () => {
    const lonely = [...VAULT, note("Lose.md")];

    expect(rankRelated("Lose.md", lonely)).toEqual([]);
  });

  it("weighs a rare shared link above a link everything shares", () => {
    const hub = "Index.md";
    const vault: RelatedSubject[] = [
      note("Quelle.md", { links: [hub, "Selten.md"] }),
      note("Gemeinsam.md", { links: [hub, "Selten.md"] }),
      note("Nur Index.md", { links: [hub] }),
      note("Auch Index.md", { links: [hub] }),
      note("Und Index.md", { links: [hub] }),
      note("Selten.md", { backlinks: ["Quelle.md", "Gemeinsam.md"] }),
      note(hub)
    ];

    const related = rankRelated("Quelle.md", vault);

    expect(related[0]?.path).toBe("Gemeinsam.md");
  });

  it("does not let an index note make everything it lists related", () => {
    // One note links to forty others. Being on that list is not a relationship,
    // and the forty must not all answer for each other.
    const listed = Array.from({ length: 40 }, (_, index) => `Notiz ${index}.md`);
    const vault: RelatedSubject[] = [
      note("Index.md", { links: listed }),
      ...listed.map((path) => note(path, { backlinks: ["Index.md"] }))
    ];

    const related = rankRelated("Notiz 0.md", vault);

    // The index itself is directly linked, so it belongs at the top.
    expect(related[0]?.path).toBe("Index.md");

    // The other thirty-nine are only on the same list. They are all co-cited by
    // the same page, so they tie — and a tie among thirty-nine is the ranking
    // saying it knows nothing. What must hold is that the signal stays weak:
    // well below the direct link above them.
    const others = related.filter((entry) => entry.path !== "Index.md");
    expect(others.length).toBeGreaterThan(0);
    for (const entry of others) expect(entry.score).toBeLessThan(1.5);
  });

  it("weighs a rare tag above one most notes carry", () => {
    const vault: RelatedSubject[] = [
      note("Quelle.md", { tags: ["notiz", "dachterrasse"] }),
      note("Rar.md", { tags: ["notiz", "dachterrasse"] }),
      note("Häufig A.md", { tags: ["notiz"] }),
      note("Häufig B.md", { tags: ["notiz"] }),
      note("Häufig C.md", { tags: ["notiz"] })
    ];

    const related = rankRelated("Quelle.md", vault);

    expect(related[0]?.path).toBe("Rar.md");
  });

  it("uses the folder only as a tiebreak, never as a reason of its own", () => {
    const vault: RelatedSubject[] = [
      note("Ordner/Quelle.md", { tags: ["thema"] }),
      note("Ordner/Nachbar.md"),
      note("Anderswo/Thema.md", { tags: ["thema"] })
    ];

    const related = rankRelated("Ordner/Quelle.md", vault);

    // A shared tag puts a note on the list; a shared folder alone does not.
    expect(related.map((entry) => entry.path)).toEqual(["Anderswo/Thema.md"]);
  });

  it("breaks a tie by what was touched most recently", () => {
    const vault: RelatedSubject[] = [
      note("Quelle.md", { tags: ["thema"] }),
      note("Alt.md", { tags: ["thema"], modifiedAt: 100 }),
      note("Neu.md", { tags: ["thema"], modifiedAt: 900 })
    ];

    const related = rankRelated("Quelle.md", vault);

    expect(related.map((entry) => entry.path)).toEqual(["Neu.md", "Alt.md"]);
  });

  it("names every reason a note is on the list, strongest first", () => {
    const related = rankRelated("Objekte/Objekt 12.md", VAULT);
    const expose = related.find((entry) => entry.path === "Objekte/Exposé 12.md");

    expect(expose?.reasons.map((reason) => reason.kind)).toEqual(["backlink", "tag", "folder"]);
  });

  it("caps a long list rather than filtering it", () => {
    const vault: RelatedSubject[] = [
      note("Quelle.md", { links: ["Thema.md"] }),
      ...Array.from({ length: RELATED_LIMIT + 10 }, (_, index) =>
        note(`Notiz ${index}.md`, { links: ["Thema.md"], modifiedAt: index })
      )
    ];

    expect(rankRelated("Quelle.md", vault)).toHaveLength(RELATED_LIMIT);
  });

  it("honours a limit the caller asks for", () => {
    expect(rankRelated("Objekte/Objekt 12.md", VAULT, { limit: 1 })).toHaveLength(1);
  });
});

describe("backlinkIndex", () => {
  it("inverts who links to what into who is linked by whom", () => {
    const index = backlinkIndex({
      "A.md": { "C.md": 1 },
      "B.md": { "C.md": 2, "D.md": 1 }
    });

    expect(index.get("C.md")).toEqual(["A.md", "B.md"]);
    expect(index.get("D.md")).toEqual(["B.md"]);
  });

  it("names a note once however often it links to the same file", () => {
    // Obsidian's table counts links written; the ranking counts notes shared.
    const index = backlinkIndex({ "A.md": { "C.md": 7 } });

    expect(index.get("C.md")).toEqual(["A.md"]);
  });

  it("says nothing about a note nobody links", () => {
    expect(backlinkIndex({ "A.md": {} }).get("A.md")).toBeUndefined();
  });
});

describe("a note linking to itself", () => {
  it("does not count its own link as one it shares", () => {
    const vault: RelatedSubject[] = [
      note("A/Quelle.md", { links: ["A/Quelle.md"], backlinks: ["A/Quelle.md", "B/Fan.md"] }),
      note("B/Fan.md", { links: ["A/Quelle.md"] })
    ];

    const [fan] = rankRelated("A/Quelle.md", vault);

    expect(fan?.path).toBe("B/Fan.md");
    expect(fan?.reasons).toEqual([{ kind: "backlink", count: 1 }]);
  });

  it("does not make a self-linking neighbour share a link with the source", () => {
    const vault: RelatedSubject[] = [
      note("A/Quelle.md", { links: ["B/Selbst.md"] }),
      note("B/Selbst.md", { links: ["B/Selbst.md"], backlinks: ["A/Quelle.md", "B/Selbst.md"] })
    ];

    const [self] = rankRelated("A/Quelle.md", vault);

    expect(self?.reasons.map((reason) => reason.kind)).toEqual(["link"]);
  });
});

describe("reasons", () => {
  it("lead with the one that added most, not the one worth most in general", () => {
    // Three rare tags against one link to a note everything links to.
    const hub = "Hub.md";
    const crowd = Array.from({ length: 30 }, (_, i) => note(`C/${i}.md`, { links: [hub] }));
    const vault: RelatedSubject[] = [
      note("A/Quelle.md", { links: [hub], tags: ["x", "y", "z"] }),
      note("B/Treffer.md", { links: [hub], tags: ["x", "y", "z"] }),
      note(hub),
      ...crowd
    ];

    const top = rankRelated("A/Quelle.md", vault)[0];

    expect(top?.path).toBe("B/Treffer.md");
    expect(top?.reasons[0]?.kind).toBe("tag");
  });
});

describe("linkDegrees", () => {
  it("counts what every file sends and receives, canvases included", () => {
    const degrees = linkDegrees({
      "Board.canvas": { "A.md": 1, "B.md": 1, "C.md": 1 },
      "A.md": { "B.md": 3 }
    });

    expect(degrees.outbound.get("Board.canvas")).toBe(3);
    expect(degrees.outbound.get("A.md")).toBe(1);
    expect(degrees.inbound.get("B.md")).toBe(2);
  });

  it("makes a large canvas a weak reason to call its cards related", () => {
    const cards = Array.from({ length: 40 }, (_, i) => `K/${i}.md`);
    const resolved: Record<string, Record<string, number>> = {
      "Board.canvas": Object.fromEntries(cards.map((card) => [card, 1])),
      "Liste.md": { "K/0.md": 1, "P/Paar.md": 1 }
    };
    const backlinks = backlinkIndex(resolved);
    const vault: RelatedSubject[] = [...cards, "P/Paar.md", "Liste.md"].map((path) =>
      note(path, {
        links: Object.keys(resolved[path] ?? {}),
        backlinks: backlinks.get(path) ?? []
      })
    );

    const related = rankRelated("K/0.md", vault, { degrees: linkDegrees(resolved) });

    // Listed together on a short list beats sitting together on a huge board.
    expect(related[0]?.path).toBe("P/Paar.md");
  });
});

describe("relatedTags", () => {
  it("strips, lowercases, composes and dedupes", () => {
    expect(relatedTags(["#Übung", "#Übung", "#Projekt", "projekt"])).toEqual(["übung", "projekt"]);
  });

  it("drops what is not a tag", () => {
    expect(relatedTags(["#ok", 7, null, "#", { tag: "x" }])).toEqual(["ok"]);
    expect(relatedTags("not a list")).toEqual([]);
  });
});

describe("limit", () => {
  it("is bounded however much is asked for", () => {
    const vault = Array.from({ length: 150 }, (_, i) => note(`N/${i}.md`, { links: ["Hub.md"] }));

    expect(rankRelated("N/0.md", vault, { limit: 10_000 })).toHaveLength(100);
    expect(rankRelated("N/0.md", vault, { limit: -3 })).toEqual([]);
  });
});

describe("the folder as a tiebreak", () => {
  it("orders two notes that share the same thing", () => {
    const vault: RelatedSubject[] = [
      note("Ordner/Quelle.md", { tags: ["thema"] }),
      note("Anderswo/Fern.md", { tags: ["thema"] }),
      note("Ordner/Nah.md", { tags: ["thema"] })
    ];

    const related = rankRelated("Ordner/Quelle.md", vault);

    expect(related.map((entry) => entry.path)).toEqual(["Ordner/Nah.md", "Anderswo/Fern.md"]);
    expect(related[0]?.reasons.map((reason) => reason.kind)).toEqual(["tag", "folder"]);
  });
});

describe("notes related by tags alone", () => {
  // A shelf of a hundred reading notes, all tagged alike, and two that share a rare tag.
  const shelf = (): RelatedSubject[] => [
    note("Lesestapel/Quelle.md", { tags: ["lesen", "ki", "llm"] }),
    note("Lesestapel/Selten.md", { tags: ["lesen", "llm"] }),
    ...Array.from({ length: 98 }, (_, i) => note(`Lesestapel/N${i}.md`, { tags: ["lesen", "ki"] })),
    note("Projekte/Verlinkt.md", { tags: ["lesen"], backlinks: ["Lesestapel/Quelle.md"] })
  ];

  it("lists a note sharing only common tags no more, and one sharing a rare tag still", () => {
    const vault = shelf();
    const source = vault[0];
    if (source) source.links = ["Projekte/Verlinkt.md"];
    const ranked = rankRelated("Lesestapel/Quelle.md", vault).map((r) => r.path);
    expect(ranked).toContain("Lesestapel/Selten.md");
    expect(ranked.some((path) => /\/N\d+\.md$/.test(path))).toBe(false);
  });

  it("still counts a common tag beside a link", () => {
    const vault = shelf();
    const source = vault[0];
    if (source) source.links = ["Projekte/Verlinkt.md"];
    const linked = rankRelated("Lesestapel/Quelle.md", vault).find(
      (r) => r.path === "Projekte/Verlinkt.md"
    );
    expect(linked?.reasons.map((r) => r.kind)).toEqual(["link", "tag"]);
  });

  it("calls a tag rare by its share of the vault, and never below a handful of notes", () => {
    expect(isRareTag(50, 1000)).toBe(true);
    expect(isRareTag(51, 1000)).toBe(false);
    expect(isRareTag(3, 10)).toBe(true);
    expect(isRareTag(4, 10)).toBe(false);
  });
});
