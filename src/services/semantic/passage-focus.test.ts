import { describe, expect, it } from "vitest";
import { passageHash, passageHashes } from "./embedding-index";
import { choosePassages, focusHashes, sectionKey } from "./passage-focus";
import { vaultNoteChunks } from "./vault-retrieval";

/** Sections long enough that each is a passage of its own at `MAX`. */
const MAX = 60;
const section = (name: string): string =>
  `## ${name}\n${`${name} is the subject of this section `.repeat(1)}`;
const NOTE = ["# Title", "", section("Kitchen"), section("Garden"), section("Cellar")].join("\n");
const passages = vaultNoteChunks(NOTE, MAX);
const lineOf = (text: string, needle: string): number =>
  text.split("\n").findIndex((line) => line.includes(needle));
/** Which passage of `NOTE` each hash is, for reading an order back. */
const indexOf = (hashes: number[]): number[] =>
  hashes.map((hash) => passages.findIndex((p) => passageHash(p) === hash));

describe("focusHashes", () => {
  it("starts at the section the line is in, then works outwards on both sides", () => {
    expect(passages.length).toBeGreaterThanOrEqual(3);
    const garden = passages.findIndex((p) => p.includes("Garden is"));
    const order = indexOf(focusHashes(NOTE, lineOf(NOTE, "Garden is"), MAX));
    expect(order[0]).toBe(garden);
    expect(order.slice(1, 3).sort()).toEqual([garden - 1, garden + 1].sort());
    expect([...order].sort()).toEqual(passages.map((_, i) => i));
  });

  it("starts at the last passage for the end", () => {
    const order = indexOf(focusHashes(NOTE, "end", MAX));
    expect(order).toEqual(passages.map((_, i) => passages.length - 1 - i));
  });

  it("finds the heading line itself, and a line before the first heading", () => {
    const kitchen = passages.findIndex((p) => p.includes("Kitchen is"));
    expect(indexOf(focusHashes(NOTE, lineOf(NOTE, "## Kitchen"), MAX))[0]).toBe(kitchen);
    expect(indexOf(focusHashes(NOTE, 0, MAX))[0]).toBe(0);
    expect(indexOf(focusHashes(NOTE, -5, MAX))[0]).toBe(0);
  });

  it("takes every window of a long section, and a short section joined with others", () => {
    const long = ["## Long", "word ".repeat(60).trim(), "## Next", "short"].join("\n");
    const cut = vaultNoteChunks(long, MAX);
    const windows = cut.filter((p) => p.includes("word"));
    expect(windows.length).toBeGreaterThan(1);
    const first = focusHashes(long, 1, MAX).slice(0, windows.length);
    expect(first.sort()).toEqual(windows.map(passageHash).sort());

    const joined = ["## A", "a", "## B", "b"].join("\n");
    expect(vaultNoteChunks(joined, MAX)).toHaveLength(1);
    expect(focusHashes(joined, 3, MAX)).toEqual([
      passageHash(vaultNoteChunks(joined, MAX)[0] ?? "")
    ]);
  });

  it("counts a line past the passages a note is embedded as as the last of them", () => {
    const huge = Array.from(
      { length: 120 },
      (_, i) => `## S${i}\n${"x".repeat(MAX - 10)} ${i}`
    ).join("\n");
    const cut = vaultNoteChunks(huge, MAX);
    const order = focusHashes(huge, huge.split("\n").length - 1, MAX);
    expect(order[0]).toBe(passageHash(cut[cut.length - 1] ?? ""));
  });

  it("is empty for a note with no text", () => {
    expect(focusHashes("", 0, MAX)).toEqual([]);
    expect(focusHashes("---\na: 1\n---\n", "end", MAX)).toEqual([]);
  });
});

describe("choosePassages", () => {
  const chunks = ["a", "b", "c", "d", "e"];
  const stored = passageHashes(chunks);
  const want = (...texts: string[]): number[] => texts.map(passageHash);

  it("takes the stored passages wanted first, at most the limit, in the note's order", () => {
    expect(choosePassages(chunks, stored, want("d", "c", "e", "b"), "opening", 3)).toEqual([
      "c",
      "d",
      "e"
    ]);
  });

  it("passes over a passage written since, for the nearest that is stored", () => {
    expect(choosePassages(chunks, stored, want("new", "c", "b"), "opening", 2)).toEqual(["b", "c"]);
  });

  it("takes a passage that appears twice as two", () => {
    const twice = ["x", "y", "x"];
    expect(choosePassages(twice, passageHashes(twice), want("x", "x"), "opening")).toEqual([
      "x",
      "x"
    ]);
  });

  it("falls back to position without hashes, with hashes that do not fit, or with none wanted", () => {
    expect(choosePassages(chunks, undefined, want("e"), "opening", 2)).toEqual(["a", "b"]);
    expect(choosePassages(chunks, undefined, want("a"), "end", 2)).toEqual(["d", "e"]);
    expect(choosePassages(chunks, passageHashes(["a"]), want("e"), "end", 2)).toEqual(["d", "e"]);
    expect(choosePassages(chunks, stored, [], "opening", 2)).toEqual(["a", "b"]);
    expect(choosePassages(chunks, stored, want("gone"), "end", 9)).toEqual(chunks);
  });
});

describe("sectionKey", () => {
  it("is the same within a section and differs between sections", () => {
    const kitchen = lineOf(NOTE, "Kitchen is");
    expect(sectionKey(NOTE, kitchen)).toBe(sectionKey(NOTE, lineOf(NOTE, "## Kitchen")));
    expect(sectionKey(NOTE, kitchen)).not.toBe(sectionKey(NOTE, lineOf(NOTE, "Garden is")));
    expect(sectionKey(NOTE, 0)).toBe(1);
  });

  it("does not take a heading inside a code block for a section", () => {
    const code = ["## One", "text", "```", "## not a heading", "```", "more"].join("\n");
    expect(sectionKey(code, 5)).toBe(sectionKey(code, 1));
  });
});
