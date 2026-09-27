import { describe, expect, it } from "vitest";
import {
  hasUnseenSync,
  LATEST_MAX,
  newestSync,
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
    const { synced } = selectLatest(MIRRORS);

    expect(synced.map((file) => file.path)).toEqual(["Quellen/Neu.md", "Quellen/Alt.md"]);
  });

  it("lists every note still waiting, well past the old default of five", () => {
    const many = Array.from({ length: 12 }, (_, i) => note(`n${i}.md`, i + 1));

    expect(selectLatest(many).synced).toHaveLength(12);
  });

  it("stops at the ceiling, keeping the newest", () => {
    const many = Array.from({ length: LATEST_MAX + 7 }, (_, i) => note(`n${i}.md`, i + 1));
    const { synced } = selectLatest(many);

    expect(synced).toHaveLength(LATEST_MAX);
    expect(synced[0]?.syncedAt).toBe(LATEST_MAX + 7);
  });

  it("is empty in a vault that mirrors nothing", () => {
    expect(selectLatest([note("Alt.md"), note("Neu.md")]).synced).toEqual([]);
  });

  it("breaks a tie by path, so a redraw does not reorder rows", () => {
    const tied = [note("B.md", 50), note("A.md", 50), note("C.md", 50)];

    expect(selectLatest(tied).synced.map((file) => file.path)).toEqual(["A.md", "B.md", "C.md"]);
  });

  it("does not mutate what it was given", () => {
    const input = [...MIRRORS];
    selectLatest(input);

    expect(input.map((file) => file.path)).toEqual(MIRRORS.map((file) => file.path));
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
