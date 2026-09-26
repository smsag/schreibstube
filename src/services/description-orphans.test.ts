import { describe, expect, it } from "vitest";
import {
  MAX_ORPHAN_PICTURE_BYTES,
  matchOrphans,
  orphanFacts,
  picturesToHash,
  type OrphanFacts
} from "./description-orphans";

const KEYS = { image: "img", hash: "hash", size: "size" };
const HASH_A = "0123456789abcdef";
const HASH_B = "fedcba9876543210";
const orphan = (
  path: string,
  hash: string,
  size: number,
  link = `Alt/${path}.jpg`
): OrphanFacts => ({
  path,
  link,
  hash,
  size
});

describe("orphanFacts", () => {
  it("reads the link, the hash and the size", () => {
    expect(orphanFacts("n.md", { img: "[[Alt/see.jpg]]", hash: HASH_A, size: 1200 }, KEYS)).toEqual(
      {
        path: "n.md",
        link: "Alt/see.jpg",
        hash: HASH_A,
        size: 1200
      }
    );
  });

  it("refuses what a hand edit or another plugin could have left", () => {
    expect(orphanFacts("n.md", undefined, KEYS)).toBeNull();
    expect(orphanFacts("n.md", { img: "see.jpg", hash: HASH_A, size: 1 }, KEYS)).toBeNull();
    expect(orphanFacts("n.md", { img: "[[a]]", hash: "xyz", size: 1 }, KEYS)).toBeNull();
    expect(orphanFacts("n.md", { img: "[[a]]", hash: HASH_A, size: "1" }, KEYS)).toBeNull();
    expect(orphanFacts("n.md", { img: "[[a]]", hash: HASH_A, size: 0 }, KEYS)).toBeNull();
    expect(orphanFacts("n.md", { img: "[[a]]", hash: HASH_A, size: 1.5 }, KEYS)).toBeNull();
  });
});

describe("picturesToHash", () => {
  it("reads only pictures of a recorded size, each once", () => {
    const out = picturesToHash(
      [orphan("a", HASH_A, 100), orphan("b", HASH_B, 100)],
      [
        { path: "x.jpg", size: 100 },
        { path: "y.jpg", size: 200 },
        { path: "z.jpg", size: 100 }
      ]
    );
    expect(out).toEqual(["x.jpg", "z.jpg"]);
  });

  it("stops at the cap", () => {
    const pictures = Array.from({ length: 10 }, (_, i) => ({ path: `${i}.jpg`, size: 5 }));
    expect(picturesToHash([orphan("a", HASH_A, 5)], pictures, 3)).toHaveLength(3);
  });

  it("does not read a picture past the byte bound", () => {
    const size = MAX_ORPHAN_PICTURE_BYTES + 1;
    expect(picturesToHash([orphan("a", HASH_A, size)], [{ path: "big.jpg", size }])).toEqual([]);
  });
});

describe("matchOrphans", () => {
  it("repairs a note whose picture is the only one with its content", () => {
    const plans = matchOrphans(
      [orphan("a", HASH_A, 1)],
      new Map([
        ["Neu/see.jpg", HASH_A],
        ["berg.jpg", HASH_B]
      ])
    );
    expect(plans).toEqual([{ note: "a", link: "Alt/a.jpg", image: "Neu/see.jpg" }]);
  });

  it("leaves a note when two pictures carry its content", () => {
    const hashes = new Map([
      ["see.jpg", HASH_A],
      ["Kopie/see.jpg", HASH_A]
    ]);
    expect(matchOrphans([orphan("a", HASH_A, 1)], hashes)).toEqual([]);
  });

  it("leaves both notes when two describe the same content", () => {
    const hashes = new Map([["see.jpg", HASH_A]]);
    expect(matchOrphans([orphan("a", HASH_A, 1), orphan("b", HASH_A, 1)], hashes)).toEqual([]);
  });

  it("finds nothing for a picture that was not read", () => {
    expect(matchOrphans([orphan("a", HASH_A, 1)], new Map())).toEqual([]);
  });
});
