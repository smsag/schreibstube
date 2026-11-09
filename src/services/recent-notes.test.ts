import { describe, expect, it } from "vitest";
import { FOLDED_RECENT_NOTES, MAX_RECENT_NOTES, recentRows, selectRecent } from "./recent-notes";

const all = () => true;

describe("selectRecent", () => {
  it("keeps Obsidian's order and leaves out the note the footer is under", () => {
    expect(selectRecent(["a.md", "b.md", "c.md"], "b.md", all)).toEqual(["a.md", "c.md"]);
  });

  it("lists everything when no note is open", () => {
    expect(selectRecent(["a.md", "b.md"], null, all)).toEqual(["a.md", "b.md"]);
  });

  it("drops what is gone, and what is not a path at all", () => {
    const present = (path: string) => path !== "gone.md";
    expect(selectRecent(["a.md", "gone.md", 7, "", null, "b.md"], null, present)).toEqual([
      "a.md",
      "b.md"
    ]);
  });

  it("lists a path once, where it first stands", () => {
    expect(selectRecent(["a.md", "b.md", "a.md"], null, all)).toEqual(["a.md", "b.md"]);
  });

  it("asks about a repeated path only once", () => {
    const asked: string[] = [];
    selectRecent(["a.md", "a.md"], null, (path) => {
      asked.push(path);
      return true;
    });
    expect(asked).toEqual(["a.md"]);
  });

  it("stops at the bound", () => {
    const many = Array.from({ length: 30 }, (_, i) => `n${i}.md`);
    expect(selectRecent(many, null, all)).toHaveLength(MAX_RECENT_NOTES);
    expect(selectRecent(many, null, all, 2)).toEqual(["n0.md", "n1.md"]);
  });

  it("reads anything but a list as no list", () => {
    expect(selectRecent(undefined, null, all)).toEqual([]);
    expect(selectRecent("a.md", null, all)).toEqual([]);
  });
});

describe("recentRows", () => {
  it("shows a short list whole", () => {
    expect(recentRows(0, false)).toEqual({ shown: 0, hidden: 0 });
    expect(recentRows(FOLDED_RECENT_NOTES, false)).toEqual({
      shown: FOLDED_RECENT_NOTES,
      hidden: 0
    });
  });

  it("keeps three and counts the rest until told to show them", () => {
    expect(recentRows(7, false)).toEqual({ shown: 3, hidden: 4 });
    expect(recentRows(4, false)).toEqual({ shown: 3, hidden: 1 });
  });

  it("shows everything once expanded", () => {
    expect(recentRows(7, true)).toEqual({ shown: 7, hidden: 0 });
  });
});
