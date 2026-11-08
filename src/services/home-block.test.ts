import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_LIMIT,
  defaultHomeSections,
  HOME_ACTIONS,
  MAX_HOME_BLOCK_CHARS,
  MAX_HOME_LIMIT,
  MAX_HOME_SECTIONS,
  parseHomeBlock,
  planHome,
  readsDue,
  selectDue,
  type DueCandidate
} from "./home-block";

const day = (iso: string) => {
  const [year, month, dayOf] = iso.split("-").map(Number);
  return { iso, year: year ?? 0, month: month ?? 0, day: dayOf ?? 0 };
};

describe("parseHomeBlock", () => {
  it("shows every section when nothing is written", () => {
    expect(parseHomeBlock("")).toEqual({ sections: defaultHomeSections(), unreadable: [] });
    expect(parseHomeBlock("\n  \n# just a comment\n")).toEqual({
      sections: defaultHomeSections(),
      unreadable: []
    });
  });

  it("reads the sections in the order they are written", () => {
    const block = parseHomeBlock("due\nbookmarks\nupdated\nactions");
    expect(block.sections.map((section) => section.kind)).toEqual([
      "due",
      "bookmarks",
      "updated",
      "actions"
    ]);
    expect(block.unreadable).toEqual([]);
  });

  it("reads a section's limit, and caps it", () => {
    expect(parseHomeBlock("due 3").sections).toEqual([{ kind: "due", limit: 3 }]);
    expect(parseHomeBlock("updated").sections).toEqual([
      { kind: "updated", limit: DEFAULT_HOME_LIMIT }
    ]);
    expect(parseHomeBlock("bookmarks 9999").sections).toEqual([
      { kind: "bookmarks", limit: MAX_HOME_LIMIT }
    ]);
  });

  it("reports a limit that is no positive number, and a section it does not know", () => {
    const block = parseHomeBlock("due 0\ndue -1\ndue five\ndue 2 3\nrecent\nbookmarks");
    expect(block.sections).toEqual([{ kind: "bookmarks", limit: DEFAULT_HOME_LIMIT }]);
    expect(block.unreadable).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads the buttons actions picks, in its order and once each", () => {
    expect(parseHomeBlock("actions").sections).toEqual([
      { kind: "actions", actions: [...HOME_ACTIONS] }
    ]);
    expect(parseHomeBlock("Actions go-to-file NEW-NOTE go-to-file").sections).toEqual([
      { kind: "actions", actions: ["go-to-file", "new-note"] }
    ]);
    expect(parseHomeBlock("actions new-folder").unreadable).toEqual([1]);
  });

  it("shows the hint alone when every line was misspelled", () => {
    expect(parseHomeBlock("bookmark\nactoins")).toEqual({ sections: [], unreadable: [1, 2] });
  });

  it("stops at the section limit and the length limit", () => {
    const many = Array.from({ length: MAX_HOME_SECTIONS + 5 }, () => "due").join("\n");
    expect(parseHomeBlock(many).sections).toHaveLength(MAX_HOME_SECTIONS);

    const pasted = `${"#".repeat(MAX_HOME_BLOCK_CHARS)}\nbookmarks`;
    expect(parseHomeBlock(pasted).sections).toEqual(defaultHomeSections());
  });

  it("lists at most five unreadable lines", () => {
    expect(parseHomeBlock("x\nx\nx\nx\nx\nx\nx").unreadable).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads Windows line endings", () => {
    expect(parseHomeBlock("due 2\r\nbookmarks\r\n").sections).toHaveLength(2);
  });
});

describe("selectDue", () => {
  const notes: DueCandidate[] = [
    { path: "b.md", name: "B", due: day("2026-11-10") },
    { path: "a.md", name: "A", due: day("2026-11-10") },
    { path: "late.md", name: "Late", due: day("2026-10-01") },
    { path: "far.md", name: "Far", due: day("2027-03-01") }
  ];

  it("puts the earliest first and same-day notes in name order", () => {
    expect(selectDue(notes, 10).map((note) => note.path)).toEqual([
      "late.md",
      "a.md",
      "b.md",
      "far.md"
    ]);
  });

  it("stops at the limit", () => {
    expect(selectDue(notes, 2).map((note) => note.path)).toEqual(["late.md", "a.md"]);
    expect(selectDue(notes, -1)).toEqual([]);
  });

  it("orders notes of the same name by path", () => {
    const twins: DueCandidate[] = [
      { path: "z/Plan.md", name: "Plan", due: day("2026-11-10") },
      { path: "a/Plan.md", name: "Plan", due: day("2026-11-10") }
    ];
    expect(selectDue(twins, 5).map((note) => note.path)).toEqual(["a/Plan.md", "z/Plan.md"]);
  });

  it("leaves the list it was given alone", () => {
    const copy = [...notes];
    selectDue(notes, 1);
    expect(notes).toEqual(copy);
  });
});

describe("planHome", () => {
  const bookmark = (name: string) => ({
    name,
    url: `https://${name}.example`,
    kind: "web" as const
  });
  const data = {
    bookmarks: [bookmark("a"), bookmark("b"), bookmark("c")],
    bookmarksMissing: null,
    updated: [
      { path: "x.md", name: "X" },
      { path: "y.md", name: "Y" }
    ],
    due: [
      { path: "later.md", name: "Later", due: day("2026-12-01") },
      { path: "now.md", name: "Now", due: day("2026-11-07") }
    ],
    today: "2026-11-07",
    locale: "en",
    available: (action: string) => action !== "new-base"
  };

  it("fills each section and cuts it to its limit", () => {
    const model = planHome(parseHomeBlock("bookmarks 2\nupdated 1\ndue 1\nactions"), data);
    expect(model.sections).toEqual([
      { kind: "bookmarks", bookmarks: [bookmark("a"), bookmark("b")], missingFile: null },
      { kind: "updated", rows: [{ path: "x.md", name: "X" }] },
      {
        kind: "due",
        rows: [
          {
            path: "now.md",
            name: "Now",
            label: expect.objectContaining({ state: "today" }) as unknown
          }
        ]
      },
      { kind: "actions", actions: ["new-note", "go-to-file", "new-canvas"] }
    ]);
  });

  it("passes on the missing bookmarks file and the unreadable lines", () => {
    const model = planHome(parseHomeBlock("bookmarks\nnope"), {
      ...data,
      bookmarksMissing: "Bookmarks.md"
    });
    expect(model.sections[0]).toMatchObject({ missingFile: "Bookmarks.md" });
    expect(model.unreadable).toEqual([2]);
  });
});

describe("readsDue", () => {
  it("is true only when a section lists due notes", () => {
    expect(readsDue(parseHomeBlock(""))).toBe(true);
    expect(readsDue(parseHomeBlock("bookmarks\nactions"))).toBe(false);
  });
});
