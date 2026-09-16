import { describe, expect, it } from "vitest";
import {
  normalizeTag,
  noteHasTag,
  sortTagCards,
  summarizeTagCards,
  tagFromPinKey,
  tagIncludes,
  tagPinKey,
  tallyTags,
  vaultTags,
  type TagCard,
  type TaggedNote
} from "./tag-pins";

const open = { task: " " };
const done = { task: "x" };

function note(path: string, tags: string[], items: TaggedNote["items"] = []): TaggedNote {
  return { path, tags, items };
}

describe("normalizeTag", () => {
  it("takes a tag with or without its hash", () => {
    expect(normalizeTag("#projekt")).toBe("projekt");
    expect(normalizeTag("  projekt/alpha ")).toBe("projekt/alpha");
    expect(normalizeTag("#über-sicht_2")).toBe("über-sicht_2");
  });

  it("refuses what Obsidian would not read as a tag", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("#")).toBeNull();
    expect(normalizeTag("#2026")).toBeNull();
    expect(normalizeTag("#two words")).toBeNull();
    expect(normalizeTag("#a//b")).toBeNull();
    expect(normalizeTag("#a/")).toBeNull();
    expect(normalizeTag("#a:b")).toBeNull();
  });
});

describe("pin keys", () => {
  it("round-trips a tag", () => {
    expect(tagPinKey("#projekt/alpha")).toBe("tag:projekt/alpha");
    expect(tagFromPinKey("tag:projekt/alpha")).toBe("projekt/alpha");
  });

  it("is never a path a file could have", () => {
    expect(tagFromPinKey("Projekte/tag.md")).toBeNull();
    expect(tagFromPinKey("tags/projekt.md")).toBeNull();
  });

  it("has no key for something that is not a tag", () => {
    expect(tagPinKey("#")).toBeNull();
    expect(tagFromPinKey("tag:")).toBeNull();
  });
});

describe("tagIncludes", () => {
  it("includes the tag itself and everything nested under it, whatever the case", () => {
    expect(tagIncludes("projekt", "#projekt")).toBe(true);
    expect(tagIncludes("#Projekt", "#projekt/alpha")).toBe(true);
    expect(tagIncludes("projekt/alpha", "#projekt/alpha/beta")).toBe(true);
  });

  it("does not include a parent, a sibling or a tag that only starts alike", () => {
    expect(tagIncludes("projekt/alpha", "#projekt")).toBe(false);
    expect(tagIncludes("projekt/alpha", "#projekt/beta")).toBe(false);
    expect(tagIncludes("projekt", "#projekte")).toBe(false);
  });
});

describe("tallyTags", () => {
  it("adds up every task of every note carrying the tag", () => {
    const notes = [
      note("a.md", ["#projekt"], [open, done]),
      note("b.md", ["#projekt/alpha"], [open]),
      note("c.md", ["#anderes"], [open, open])
    ];
    expect(tallyTags(notes, ["projekt"]).get("projekt")).toEqual({ open: 2, total: 3 });
  });

  it("counts a note once however often it writes the tag", () => {
    const notes = [note("a.md", ["#projekt", "#Projekt", "#projekt/alpha"], [open])];
    expect(tallyTags(notes, ["projekt"]).get("projekt")).toEqual({ open: 1, total: 1 });
  });

  it("counts a note in the row of every pinned tag it carries", () => {
    const tallies = tallyTags([note("a.md", ["#projekt", "#kunde"], [open])], ["projekt", "kunde"]);
    expect(tallies.get("projekt")).toEqual({ open: 1, total: 1 });
    expect(tallies.get("kunde")).toEqual({ open: 1, total: 1 });
  });

  it("answers zero for a tag nothing carries", () => {
    expect(tallyTags([note("a.md", [], [open])], ["leer"]).get("leer")).toEqual({
      open: 0,
      total: 0
    });
  });
});

describe("noteHasTag", () => {
  it("reads the note's tags the way the count does", () => {
    expect(noteHasTag({ tags: ["#projekt/alpha"] }, "projekt")).toBe(true);
    expect(noteHasTag({ tags: [] }, "projekt")).toBe(false);
  });
});

describe("vaultTags", () => {
  it("offers parents of nested tags and counts each note once per tag", () => {
    const tags = vaultTags([
      { tags: ["#projekt/alpha", "#projekt/beta"] },
      { tags: ["#projekt"] },
      { tags: ["#kunde"] }
    ]);
    expect(tags).toEqual([
      { tag: "projekt", notes: 2 },
      { tag: "kunde", notes: 1 },
      { tag: "projekt/alpha", notes: 1 },
      { tag: "projekt/beta", notes: 1 }
    ]);
  });

  it("treats spellings that differ only in case as one tag", () => {
    expect(vaultTags([{ tags: ["#Projekt"] }, { tags: ["#projekt"] }])).toEqual([
      { tag: "Projekt", notes: 2 }
    ]);
  });
});

describe("tag cards", () => {
  function card(title: string, openCount: number, modifiedAt: number): TagCard {
    return {
      path: `${title}.md`,
      title,
      folder: "",
      tally: { open: openCount, total: openCount + 1 },
      modifiedAt
    };
  }

  it("puts the most open work first, then what changed last", () => {
    const sorted = sortTagCards([
      card("a", 0, 9),
      card("b", 2, 1),
      card("c", 2, 5),
      card("d", 1, 0)
    ]);
    expect(sorted.map((entry) => entry.title)).toEqual(["c", "b", "d", "a"]);
  });

  it("sums the list for its heading", () => {
    expect(summarizeTagCards([card("a", 1, 0), card("b", 2, 0)])).toEqual({
      notes: 2,
      open: 3,
      total: 5
    });
  });
});
