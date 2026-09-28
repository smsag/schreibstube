import { describe, expect, it } from "vitest";
import { folderOf, isAtOrUnder, pathAfterMove } from "./path-follow";

describe("isAtOrUnder", () => {
  it("holds for the path itself and for anything below it", () => {
    expect(isAtOrUnder("A/b.md", "A/b.md")).toBe(true);
    expect(isAtOrUnder("A/B/c.md", "A")).toBe(true);
  });

  it("does not mistake a folder for one whose name it starts with", () => {
    expect(isAtOrUnder("Alphabet/c.md", "Alpha")).toBe(false);
  });
});

describe("pathAfterMove", () => {
  it("follows the file itself", () => {
    expect(pathAfterMove("A/b.md", "A/b.md", "C/d.md")).toBe("C/d.md");
  });

  it("follows a file whose folder moved", () => {
    expect(pathAfterMove("A/B/c.md", "A/B", "X")).toBe("X/c.md");
  });

  it("leaves everything else where it is", () => {
    expect(pathAfterMove("Alphabet/c.md", "Alpha", "Omega")).toBe("Alphabet/c.md");
  });
});

describe("folderOf", () => {
  const folder = (path: string, root = false) => ({ path, isRoot: () => root });

  it("names the folder a file sits in", () => {
    expect(folderOf({ parent: folder("A/B") })).toBe("A/B");
  });

  it("reads the vault root, and no parent at all, as no folder", () => {
    expect(folderOf({ parent: folder("/", true) })).toBe("");
    expect(folderOf({ parent: null })).toBe("");
  });
});
