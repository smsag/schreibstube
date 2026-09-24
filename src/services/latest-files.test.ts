import { describe, expect, it } from "vitest";
import {
  hasUnseenSync,
  isExcluded,
  normalizeExcluded,
  newestSync,
  parseExcludedPaths,
  selectLatest,
  type LatestCandidate
} from "./latest-files";

function note(path: string, syncedAt?: number): LatestCandidate {
  return {
    path,
    name: path.split("/").pop() ?? path,
    ...(syncedAt === undefined ? {} : { syncedAt })
  };
}

const MIRRORS: LatestCandidate[] = [
  note("Quellen/Alt.md", 500),
  note("Quellen/Neu.md", 900),
  note("Eigene/Notiz.md")
];

describe("selectLatest", () => {
  it("lists them newest first, and only the ones a source changed", () => {
    const { synced } = selectLatest(MIRRORS, { count: 5 });

    expect(synced.map((file) => file.path)).toEqual(["Quellen/Neu.md", "Quellen/Alt.md"]);
  });

  it("keeps to the count", () => {
    const many = [note("a.md", 10), note("b.md", 20), note("c.md", 30), note("d.md", 40)];

    expect(selectLatest(many, { count: 2 }).synced.map((file) => file.path)).toEqual([
      "d.md",
      "c.md"
    ]);
  });

  it("returns nothing when the count is zero", () => {
    expect(selectLatest(MIRRORS, { count: 0 })).toEqual({ synced: [] });
  });

  it("is empty in a vault that mirrors nothing", () => {
    expect(selectLatest([note("Alt.md"), note("Neu.md")], { count: 5 }).synced).toEqual([]);
  });

  it("obeys the exclusion list", () => {
    const { synced } = selectLatest(MIRRORS, {
      count: 5,
      excluded: parseExcludedPaths("Quellen/Neu.md")
    });

    expect(synced.map((file) => file.path)).toEqual(["Quellen/Alt.md"]);
  });

  it("breaks a tie by path, so a redraw does not reorder rows", () => {
    const tied = [note("B.md", 50), note("A.md", 50), note("C.md", 50)];

    expect(selectLatest(tied, { count: 5 }).synced.map((file) => file.path)).toEqual([
      "A.md",
      "B.md",
      "C.md"
    ]);
  });

  it("does not mutate what it was given", () => {
    const input = [...MIRRORS];
    selectLatest(input, { count: 2 });

    expect(input.map((file) => file.path)).toEqual(MIRRORS.map((file) => file.path));
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

  it("takes everything under the folder out of the list", () => {
    // The setting used to match a file path exactly, so naming a folder — which
    // is what anyone types into a field called "never show these" — excluded
    // nothing at all, without saying so.
    const { synced } = selectLatest(PRIVATE, {
      count: 5,
      excluded: parseExcludedPaths("Familiäres")
    });

    expect(synced.map((file) => file.path)).toEqual(["Familienrecht/Urteil.md", "Arbeit/Notiz.md"]);
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

describe("the mark that a source changed", () => {
  const updated: LatestCandidate[] = [note("Alt.md", 300), note("Neu.md", 900)];

  it("takes the newest change, whatever order the list is in", () => {
    expect(newestSync(updated)).toBe(900);
    expect(newestSync([...updated].reverse())).toBe(900);
  });

  it("says nothing about a list holding no mirrored note", () => {
    expect(newestSync([note("Alt.md")])).toBeNull();
    expect(newestSync([])).toBeNull();
  });

  it("shows while a change is newer than what was acknowledged", () => {
    expect(hasUnseenSync(updated, 899)).toBe(true);
    expect(hasUnseenSync(updated, 0)).toBe(true);
  });

  it("comes down once the newest change is the one acknowledged", () => {
    // Acknowledging the newest acknowledges everything older with it: a person
    // who looked at the list looked at all of it.
    expect(hasUnseenSync(updated, 900)).toBe(false);
    expect(hasUnseenSync(updated, 1000)).toBe(false);
  });

  it("never shows for a vault that mirrors nothing", () => {
    expect(hasUnseenSync([note("Alt.md")], 0)).toBe(false);
  });
});
