import { describe, expect, it } from "vitest";
import {
  bookmarkFolderPath,
  bookmarkNoteTarget,
  classifyBookmarkUrl,
  emptyBookmarkTree,
  flattenBookmarks,
  isBookmarkTreeEmpty,
  MAX_BOOKMARK_FILE_CHARS,
  MAX_BOOKMARK_LINE,
  MAX_BOOKMARKS,
  parseBookmarkFile,
  vaultUrlFor
} from "./bookmark-file";

const FILE = [
  "- [Loose](https://example.com/loose)",
  "",
  "# Work",
  "- [Linear](https://linear.app/team)",
  "- [Vault folder](vault://Immobilien/Objekte)",
  "",
  "## Design",
  "- [[Design Brief]]",
  "- [Figma](https://figma.com/file/abc)",
  "",
  "# Personal",
  "- [Home](http://homeassistant.local)"
].join("\n");

describe("parseBookmarkFile", () => {
  it("reads folders, subfolders and loose bookmarks", () => {
    const tree = parseBookmarkFile(FILE);

    expect(tree.loose.map((b) => b.name)).toEqual(["Loose"]);
    expect(tree.folders.map((f) => f.name)).toEqual(["Work", "Personal"]);
    expect(tree.folders[0]?.bookmarks.map((b) => b.name)).toEqual(["Linear", "Vault folder"]);
    expect(tree.folders[0]?.subfolders.map((f) => f.name)).toEqual(["Design"]);
    expect(tree.folders[0]?.subfolders[0]?.bookmarks.map((b) => b.name)).toEqual([
      "Design Brief",
      "Figma"
    ]);
  });

  it("derives the kind from the scheme", () => {
    const tree = parseBookmarkFile(FILE);

    expect(tree.folders[0]?.bookmarks[0]?.kind).toBe("web");
    expect(tree.folders[0]?.bookmarks[1]?.kind).toBe("folder");
    expect(tree.folders[0]?.subfolders[0]?.bookmarks[0]?.kind).toBe("note");
  });

  it("turns a wikilink into a note URL and keeps its label", () => {
    const tree = parseBookmarkFile("- [[Work/Brief|The brief]]\n- [[Plain]]");

    expect(tree.loose[0]).toEqual({
      name: "The brief",
      url: "note://Work/Brief",
      kind: "note"
    });
    expect(tree.loose[1]).toEqual({ name: "Plain", url: "note://Plain", kind: "note" });
  });

  it("accepts a wikilink written inside a Markdown link", () => {
    const tree = parseBookmarkFile("- [Brief]([[Work/Brief]])");

    expect(tree.loose[0]).toEqual({ name: "Brief", url: "note://Work/Brief", kind: "note" });
  });

  it("reads a Markdown link without a scheme as a note, as Obsidian writes one", () => {
    const tree = parseBookmarkFile(
      [
        "- [Today I learned](Today%20I%20learned.md)",
        "- [Brief](<Work/The Brief.md>)",
        "- [Section](./Work/Plan.md#Goals)",
        "# Work",
        "- [Rooted](/Work/Plan.md)"
      ].join("\n")
    );

    expect(tree.loose).toEqual([
      { name: "Today I learned", url: "note://Today I learned", kind: "note" },
      { name: "Brief", url: "note://Work/The Brief", kind: "note" },
      { name: "Section", url: "note://Work/Plan#Goals", kind: "note" }
    ]);
    expect(tree.folders[0]?.bookmarks[0]?.url).toBe("note://Work/Plan");
  });

  it("keeps a stray percent sign in a note link as written", () => {
    const tree = parseBookmarkFile("- [Rent](100%25 and 5%.md)");

    expect(tree.loose[0]?.url).toBe("note://100%25 and 5%");
  });

  it("does not take a link to a host or a bare heading for a note", () => {
    const tree = parseBookmarkFile(
      ["- [Host](//example.com/x)", "- [Heading](#Goals)", "- [Mail](mailto:a@b.de)"].join("\n")
    );

    expect(isBookmarkTreeEmpty(tree)).toBe(true);
  });

  it("opens an allowed link Obsidian wrapped in angle brackets", () => {
    const tree = parseBookmarkFile("- [Vault](<obsidian://open?vault=My Vault>)");

    expect(tree.loose[0]).toEqual({
      name: "Vault",
      url: "obsidian://open?vault=My Vault",
      kind: "obsidian"
    });
  });

  it("passes a plugin's Obsidian URI through untouched, escapes and query included", () => {
    // A plugin reads its own query, so the vault name stays escaped as written.
    const url =
      "obsidian://pythia?vault=Vault%202.0&cmd=resume&id=71b21d6b-39d8-42f3-bc2a-52b4096502b9";
    const tree = parseBookmarkFile(`- [Resume](${url})\n- [Wrapped](<${url}>)`);

    expect(tree.loose).toEqual([
      { name: "Resume", url, kind: "obsidian" },
      { name: "Wrapped", url, kind: "obsidian" }
    ]);
  });

  it("drops schemes that must never be opened", () => {
    const tree = parseBookmarkFile(
      [
        "- [Script](javascript:alert(1))",
        "- [Local](file:///etc/passwd)",
        "- [Data](data:text/html,<b>)",
        "- [Fine](https://example.com)"
      ].join("\n")
    );

    expect(tree.loose.map((b) => b.name)).toEqual(["Fine"]);
  });

  it("keeps a name with a bracket and a URL with parentheses", () => {
    const tree = parseBookmarkFile("- [Stack Overflow [closed]](https://example.com/a_(b)?q=(1))");

    expect(tree.loose[0]?.name).toBe("Stack Overflow [closed]");
    expect(tree.loose[0]?.url).toBe("https://example.com/a_(b)?q=(1)");
  });

  it("strips control characters rather than drawing them into a row", () => {
    const tree = parseBookmarkFile("- [Two\tlines\u0000](https://example.com)");

    expect(tree.loose[0]?.name).toBe("Two lines");
  });

  it("treats a subheading before any heading as a top-level folder", () => {
    const tree = parseBookmarkFile("## Orphan\n- [A](https://example.com)");

    expect(tree.folders.map((f) => f.name)).toEqual(["Orphan"]);
    expect(tree.folders[0]?.bookmarks).toHaveLength(1);
  });

  it("ignores prose, empty headings and malformed items", () => {
    const tree = parseBookmarkFile(
      ["Some note to self.", "# ", "## ", "- [](https://example.com)", "- [No url]()"].join("\n")
    );

    expect(isBookmarkTreeEmpty(tree)).toBe(true);
  });

  it("accepts asterisk bullets and indented items", () => {
    const tree = parseBookmarkFile("* [A](https://a.example)\n  - [B](https://b.example)");

    expect(tree.loose.map((b) => b.name)).toEqual(["A", "B"]);
  });

  it("reads an empty file as an empty tree", () => {
    expect(isBookmarkTreeEmpty(parseBookmarkFile(""))).toBe(true);
    expect(isBookmarkTreeEmpty(emptyBookmarkTree())).toBe(true);
  });
});

describe("headings and blocks", () => {
  it("keeps the heading a wikilink points at, and names it as Obsidian does", () => {
    const tree = parseBookmarkFile(
      ["- [[Note#Goals]]", "- [[Note#^block-1|Block]]", "- [Plan]([[Work/Plan#Now]])"].join("\n")
    );

    expect(tree.loose).toEqual([
      { name: "Note > Goals", url: "note://Note#Goals", kind: "note" },
      { name: "Block", url: "note://Note#^block-1", kind: "note" },
      { name: "Plan", url: "note://Work/Plan#Now", kind: "note" }
    ]);
  });

  it("keeps the heading a Markdown link points at, decoded", () => {
    const tree = parseBookmarkFile("- [Goals](Work/Plan.md#N%C3%A4chste%20Schritte)");

    expect(tree.loose[0]?.url).toBe("note://Work/Plan#Nächste Schritte");
  });

  it("takes no heading-only wikilink for a note", () => {
    expect(isBookmarkTreeEmpty(parseBookmarkFile("- [[#Goals]]"))).toBe(true);
  });
});

describe("what a person types by hand", () => {
  it("reads a task line as the link it holds", () => {
    const tree = parseBookmarkFile(
      ["- [ ] [Open](https://a.example)", "- [x] [Done](https://b.example)", "- [ ] [[Note]]"].join(
        "\n"
      )
    );

    expect(tree.loose.map((b) => [b.name, b.url])).toEqual([
      ["Open", "https://a.example"],
      ["Done", "https://b.example"],
      ["Note", "note://Note"]
    ]);
  });

  it("reads a web address without its scheme as a web link", () => {
    const tree = parseBookmarkFile("- [Example](www.example.com/a)");

    expect(tree.loose[0]).toEqual({
      name: "Example",
      url: "https://www.example.com/a",
      kind: "web"
    });
  });

  it("nests a third-level heading under the second", () => {
    const tree = parseBookmarkFile(
      ["# A", "## B", "### C", "- [x](https://x.example)", "## D", "- [y](https://y.example)"].join(
        "\n"
      )
    );

    const a = tree.folders[0];
    expect(a?.subfolders.map((f) => f.name)).toEqual(["B", "D"]);
    expect(a?.subfolders[0]?.subfolders[0]?.name).toBe("C");
    expect(a?.subfolders[0]?.subfolders[0]?.bookmarks.map((b) => b.name)).toEqual(["x"]);
    expect(a?.subfolders[1]?.bookmarks.map((b) => b.name)).toEqual(["y"]);
  });

  it("puts a heading that skips a level one level down, not two", () => {
    const tree = parseBookmarkFile("# A\n### C\n- [x](https://x.example)");

    expect(tree.folders[0]?.subfolders.map((f) => f.name)).toEqual(["C"]);
  });

  it("gives two folders of the same name keys of their own", () => {
    const tree = parseBookmarkFile("# A\n## S\n# A\n## S\n## S");

    expect(tree.folders.map((f) => f.key)).toEqual(["A", "A\u001e2"]);
    expect(tree.folders[1]?.subfolders.map((f) => f.key)).toEqual([
      "A\u001e2\u001fS",
      "A\u001e2\u001fS\u001e2"
    ]);
  });

  it("keys a folder as the pane always stored it, so a fold survives the update", () => {
    const tree = parseBookmarkFile("# Work\n## Design");

    expect(tree.folders[0]?.key).toBe("Work");
    expect(tree.folders[0]?.subfolders[0]?.key).toBe("Work\u001fDesign");
  });
});

describe("the budget", () => {
  const item = (i: number): string => `- [B${i}](https://example.com/${i})`;

  it("reads a long line of brackets in linear time", () => {
    // Fifty lines just under the ceiling on a line, each the worst case for a
    // pattern that backtracks: a second or more with the old one.
    const hostile = Array.from({ length: 25 }, () => [
      `- [${"](".repeat(2000)}x`,
      `- [a](${" ".repeat(4000)}x`
    ])
      .flat()
      .join("\n");
    const started = performance.now();
    parseBookmarkFile(hostile);

    expect(performance.now() - started).toBeLessThan(150);
  });

  it("skips a line longer than a bookmark anybody typed", () => {
    const long = `- [Long](https://example.com/${"a".repeat(MAX_BOOKMARK_LINE)})`;
    const tree = parseBookmarkFile(`${long}\n${item(1)}`);

    expect(tree.loose.map((b) => b.name)).toEqual(["B1"]);
    expect(tree.truncated).toBe(false);
  });

  it("stops at the ceiling on bookmarks and says so", () => {
    const lines = Array.from({ length: MAX_BOOKMARKS + 5 }, (_, i) => item(i));
    const tree = parseBookmarkFile(lines.join("\n"));

    expect(tree.loose).toHaveLength(MAX_BOOKMARKS);
    expect(tree.truncated).toBe(true);
  });

  it("reads no further than the ceiling on the file, and not half a line", () => {
    const line = item(0);
    const lines = Math.ceil(MAX_BOOKMARK_FILE_CHARS / (line.length + 1)) + 10;
    const text = Array.from({ length: lines }, () => line).join("\n");
    const tree = parseBookmarkFile(text);

    expect(tree.truncated).toBe(true);
    expect(tree.loose.length).toBeLessThan(lines);
    expect(tree.loose.every((b) => b.url === "https://example.com/0")).toBe(true);
  });

  it("reads a file within every ceiling whole", () => {
    expect(parseBookmarkFile(item(1)).truncated).toBe(false);
  });
});

describe("flattenBookmarks at any depth", () => {
  it("names the whole path of a nested folder", () => {
    const tree = parseBookmarkFile("# A\n## B\n### C\n- [x](https://x.example)");

    expect(flattenBookmarks(tree)).toEqual([
      { bookmark: { name: "x", url: "https://x.example", kind: "web" }, folderPath: "A / B / C" }
    ]);
  });
});

describe("flattenBookmarks", () => {
  it("lists every bookmark with the folder it came from", () => {
    expect(
      flattenBookmarks(parseBookmarkFile(FILE)).map((entry) => [
        entry.bookmark.name,
        entry.folderPath
      ])
    ).toEqual([
      ["Loose", ""],
      ["Linear", "Work"],
      ["Vault folder", "Work"],
      ["Design Brief", "Work / Design"],
      ["Figma", "Work / Design"],
      ["Home", "Personal"]
    ]);
  });
});

describe("urls", () => {
  it("classifies every scheme that may be opened", () => {
    expect(classifyBookmarkUrl("https://a.example")).toBe("web");
    expect(classifyBookmarkUrl("HTTP://a.example")).toBe("web");
    expect(classifyBookmarkUrl("obsidian://open?vault=V")).toBe("obsidian");
    expect(classifyBookmarkUrl("vault://Folder")).toBe("folder");
    expect(classifyBookmarkUrl("note://Note")).toBe("note");
    expect(classifyBookmarkUrl("ftp://a.example")).toBeNull();
  });

  it("round-trips a folder path through a vault URL", () => {
    const url = vaultUrlFor("Immobilien/Objekte & mehr/2024");

    expect(url).toBe("vault://Immobilien/Objekte%20%26%20mehr/2024");
    expect(bookmarkFolderPath(url)).toBe("Immobilien/Objekte & mehr/2024");
  });

  it("refuses a folder path that cannot be decoded", () => {
    expect(bookmarkFolderPath("vault://100%sure")).toBeNull();
    expect(bookmarkFolderPath("https://example.com")).toBeNull();
  });

  it("reads the note and the heading out of a note URL", () => {
    expect(bookmarkNoteTarget("note://Work/Brief")).toEqual({
      linkpath: "Work/Brief",
      subpath: ""
    });
    expect(bookmarkNoteTarget("note://Work/Brief#Goals")).toEqual({
      linkpath: "Work/Brief",
      subpath: "#Goals"
    });
    expect(bookmarkNoteTarget("note://Brief#^block-1")).toEqual({
      linkpath: "Brief",
      subpath: "#^block-1"
    });
  });
});
