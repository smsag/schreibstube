import { describe, expect, it } from "vitest";
import { linkTarget, pairDescriptions, type DescriptionCandidate } from "./description-pairs";

/** A vault holding these files; a link resolves by exact path or by basename. */
const vault =
  (...files: string[]) =>
  (link: string): string | null =>
    files.find((f) => f === link || f.split("/").pop() === link) ?? null;

const note = (
  path: string,
  image: unknown,
  describedAt: unknown = "2026-09-26T10:00:00Z"
): DescriptionCandidate => ({
  path,
  imageLink: image,
  describedAt
});

describe("linkTarget", () => {
  it.each([
    ["[[Objekte/a.jpg]]", "Objekte/a.jpg"],
    ["[[a.jpg|Küche]]", "a.jpg"],
    ["![[a.jpg]]", "a.jpg"],
    ["  [[ a.jpg ]] ", "a.jpg"],
    ["[[a.jpg#x]]", "a.jpg"]
  ])("reads %s", (value, expected) => {
    expect(linkTarget(value)).toBe(expected);
  });

  it.each([["a.jpg"], [""], ["[[]]"], [42], [null], [["[[a.jpg]]"]], ["[[a]] and [[b]]"]])(
    "is no pairing for %j",
    (value) => {
      expect(linkTarget(value)).toBeNull();
    }
  );
});

describe("pairDescriptions", () => {
  it("pairs a note with the picture its link resolves to", () => {
    const pairs = pairDescriptions([note("B/a.md", "[[Objekte/a.jpg]]")], vault("Objekte/a.jpg"));
    expect([...pairs.byImage]).toEqual([["Objekte/a.jpg", "B/a.md"]]);
    expect([...pairs.notes]).toEqual(["B/a.md"]);
  });

  it("ignores a note without the key: a note written by hand in the folder is left alone", () => {
    const pairs = pairDescriptions([note("B/mine.md", undefined)], vault("Objekte/a.jpg"));
    expect(pairs.notes.size).toBe(0);
    expect(pairs.orphans).toEqual([]);
  });

  it("reports a note whose picture is gone as an orphan, and never hides it", () => {
    const pairs = pairDescriptions([note("B/a.md", "[[gone.jpg]]")], vault("Objekte/a.jpg"));
    expect(pairs.orphans).toEqual(["B/a.md"]);
    expect(pairs.notes.has("B/a.md")).toBe(false);
  });

  it("does not pair a note with itself", () => {
    expect(pairDescriptions([note("B/a.md", "[[B/a.md]]")], vault("B/a.md")).orphans).toEqual([
      "B/a.md"
    ]);
  });

  it("keeps the newer of two notes about one picture, whatever order they come in", () => {
    const older = note("B/old.md", "[[a.jpg]]", "2026-01-01T00:00:00Z");
    const newer = note("B/new.md", "[[a.jpg]]", "2026-09-01T00:00:00Z");
    for (const order of [
      [older, newer],
      [newer, older]
    ]) {
      const pairs = pairDescriptions(order, vault("Objekte/a.jpg"));
      expect(pairs.byImage.get("Objekte/a.jpg")).toBe("B/new.md");
      expect(pairs.duplicates).toEqual(["B/old.md"]);
      expect(pairs.notes.has("B/old.md")).toBe(true); // hidden too: its picture is shown
    }
  });

  it("breaks a tie by path, so the answer does not depend on listing order", () => {
    const a = note("B/a.md", "[[x.jpg]]", "bad");
    const b = note("B/b.md", "[[x.jpg]]", "bad");
    expect(pairDescriptions([a, b], vault("x.jpg")).byImage.get("x.jpg")).toBe(
      pairDescriptions([b, a], vault("x.jpg")).byImage.get("x.jpg")
    );
  });
});
