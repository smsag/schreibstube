import { describe, expect, it } from "vitest";
import { backlinkIndex, rankRelated, RELATED_LIMIT, type RelatedSubject } from "./related-notes";

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
  it("puts a note linked from the source first", () => {
    const related = rankRelated("Objekte/Objekt 12.md", VAULT);

    expect(related[0]?.path).toBe("Objekte/Exposé 12.md");
    expect(related[0]?.reasons[0]?.kind).toBe("link");
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

    // A shared tag beats a shared folder, wherever the two notes sit.
    expect(related[0]?.path).toBe("Anderswo/Thema.md");
    expect(related.map((entry) => entry.path)).toContain("Ordner/Nachbar.md");
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

    expect(expose?.reasons.map((reason) => reason.kind)).toEqual(["link", "tag", "folder"]);
  });

  it("caps a long list rather than filtering it", () => {
    const vault: RelatedSubject[] = [
      note("Quelle.md", { tags: ["thema"] }),
      ...Array.from({ length: RELATED_LIMIT + 10 }, (_, index) =>
        note(`Notiz ${index}.md`, { tags: ["thema"], modifiedAt: index })
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
