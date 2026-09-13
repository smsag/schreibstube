import { describe, expect, it } from "vitest";
import {
  isExcluded,
  normalizeExcluded,
  parseExcludedPaths,
  selectLatest,
  type LatestCandidate
} from "./latest-files";

function note(path: string, createdAt: number, modifiedAt = createdAt): LatestCandidate {
  return { path, name: path.split("/").pop() ?? path, createdAt, modifiedAt };
}

const VAULT: LatestCandidate[] = [
  note("Alt.md", 100, 100),
  note("Mittel.md", 200, 900),
  note("Neu.md", 300, 300),
  note("Projekte/Brief.md", 400, 400),
  note("Projekte/Notiz.md", 500, 600)
];

describe("selectLatest", () => {
  it("orders created newest first", () => {
    const { created } = selectLatest(VAULT, { count: 3 });

    expect(created.map((file) => file.path)).toEqual([
      "Projekte/Notiz.md",
      "Projekte/Brief.md",
      "Neu.md"
    ]);
  });

  it("never repeats in modified what created already showed", () => {
    const { created, modified } = selectLatest(VAULT, { count: 2 });

    expect(created.map((file) => file.path)).toEqual(["Projekte/Notiz.md", "Projekte/Brief.md"]);
    expect(modified.map((file) => file.path)).toEqual(["Mittel.md", "Neu.md"]);
  });

  it("leaves excluded paths out of both lists", () => {
    const excluded = new Set(["Projekte/Notiz.md", "Mittel.md"]);
    const { created, modified } = selectLatest(VAULT, { count: 5, excluded });

    expect(created.map((file) => file.path)).toEqual(["Projekte/Brief.md", "Neu.md", "Alt.md"]);
    expect(modified).toHaveLength(0);
  });

  it("returns nothing when the count is zero", () => {
    expect(selectLatest(VAULT, { count: 0 })).toEqual({ synced: [], created: [], modified: [] });
  });

  it("breaks a tie by path, so a redraw does not reorder rows", () => {
    const tied = [note("B.md", 100), note("A.md", 100), note("C.md", 100)];

    expect(selectLatest(tied, { count: 3 }).created.map((file) => file.path)).toEqual([
      "A.md",
      "B.md",
      "C.md"
    ]);
  });

  it("does not mutate what it was given", () => {
    const input = [...VAULT];
    selectLatest(input, { count: 2 });

    expect(input.map((file) => file.path)).toEqual(VAULT.map((file) => file.path));
  });
});

describe("parseExcludedPaths", () => {
  it("accepts commas, newlines and leading slashes", () => {
    expect(parseExcludedPaths("bookmarks.md, /Archiv/alt.md\nProjekte/Notiz.md")).toEqual(
      new Set(["bookmarks.md", "Archiv/alt.md", "Projekte/Notiz.md"])
    );
  });

  it("reads an empty field as no exclusions", () => {
    expect(parseExcludedPaths("  ,\n ")).toEqual(new Set());
  });
});

describe("excluding a folder", () => {
  const PRIVATE: LatestCandidate[] = [
    note("Familiäres/Scheidung.md", 900),
    note("Familiäres/Kinder/Zeugnis.md", 800),
    note("Familienrecht/Urteil.md", 700),
    note("Arbeit/Notiz.md", 600)
  ];

  it("takes everything under the folder out of both lists", () => {
    // The setting used to match a file path exactly, so naming a folder — which
    // is what anyone types into a field called "never show these" — excluded
    // nothing at all, without saying so.
    const { created } = selectLatest(PRIVATE, {
      count: 5,
      excluded: parseExcludedPaths("Familiäres")
    });

    expect(created.map((file) => file.path)).toEqual([
      "Familienrecht/Urteil.md",
      "Arbeit/Notiz.md"
    ]);
  });

  it("needs a separator, so a shared prefix is not swept up with it", () => {
    const barred = normalizeExcluded(new Set(["Familie"]));

    expect(isExcluded("Familie/Brief.md", barred)).toBe(true);
    expect(isExcluded("Familienrecht/Urteil.md", barred)).toBe(false);
  });

  it("still excludes a single file named outright", () => {
    const barred = normalizeExcluded(new Set(["Arbeit/Notiz.md"]));

    expect(isExcluded("Arbeit/Notiz.md", barred)).toBe(true);
    expect(isExcluded("Arbeit/Andere.md", barred)).toBe(false);
  });

  it("ignores case, as the filesystems it runs on do", () => {
    const barred = normalizeExcluded(parseExcludedPaths("familiäres"));

    expect(isExcluded("Familiäres/Scheidung.md", barred)).toBe(true);
  });

  it("forgives a leading or trailing slash", () => {
    const barred = normalizeExcluded(parseExcludedPaths("/Familiäres/, Arbeit/"));

    expect(isExcluded("Familiäres/Scheidung.md", barred)).toBe(true);
    expect(isExcluded("Arbeit/Notiz.md", barred)).toBe(true);
  });
});

describe("notes whose source changed", () => {
  function synced(path: string, createdAt: number, syncedAt?: number): LatestCandidate {
    return { ...note(path, createdAt), ...(syncedAt === undefined ? {} : { syncedAt }) };
  }

  const MIRRORS: LatestCandidate[] = [
    synced("Quellen/Alt.md", 100, 500),
    synced("Quellen/Neu.md", 200, 900),
    synced("Eigene/Notiz.md", 300)
  ];

  it("lists them newest first, and only the ones a source changed", () => {
    const { synced: list } = selectLatest(MIRRORS, { count: 5 });

    expect(list.map((file) => file.path)).toEqual(["Quellen/Neu.md", "Quellen/Alt.md"]);
  });

  it("claims a note before the other two lists do", () => {
    // "Eigene/Notiz.md" is the newest by creation, but a mirrored note that
    // moved because its source did should say so once, in that list.
    const { synced: list, created, modified } = selectLatest(MIRRORS, { count: 5 });

    expect(list.map((file) => file.path)).toContain("Quellen/Neu.md");
    expect(created.map((file) => file.path)).not.toContain("Quellen/Neu.md");
    expect(modified.map((file) => file.path)).not.toContain("Quellen/Neu.md");
    expect(created.map((file) => file.path)).toEqual(["Eigene/Notiz.md"]);
  });

  it("keeps to the same count as the other lists", () => {
    const many = [
      synced("a.md", 1, 10),
      synced("b.md", 2, 20),
      synced("c.md", 3, 30),
      synced("d.md", 4, 40)
    ];

    expect(selectLatest(many, { count: 2 }).synced.map((file) => file.path)).toEqual([
      "d.md",
      "c.md"
    ]);
  });

  it("is empty in a vault that mirrors nothing", () => {
    expect(selectLatest(VAULT, { count: 5 }).synced).toEqual([]);
  });

  it("obeys the exclusion list like everything else", () => {
    const { synced: list } = selectLatest(MIRRORS, {
      count: 5,
      excluded: parseExcludedPaths("Quellen")
    });

    expect(list).toEqual([]);
  });

  it("breaks a tie by path, so a redraw does not reorder rows", () => {
    const tied = [synced("B.md", 1, 50), synced("A.md", 1, 50)];

    expect(selectLatest(tied, { count: 5 }).synced.map((file) => file.path)).toEqual([
      "A.md",
      "B.md"
    ]);
  });
});
