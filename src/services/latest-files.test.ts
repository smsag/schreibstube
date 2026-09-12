import { describe, expect, it } from "vitest";
import { parseExcludedPaths, selectLatest, type LatestCandidate } from "./latest-files";

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
    expect(selectLatest(VAULT, { count: 0 })).toEqual({ created: [], modified: [] });
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
