import { describe, expect, it } from "vitest";
import {
  bookmarkFolderPath,
  bookmarkGlyph,
  bookmarkLinkPath,
  classifyBookmarkUrl,
  emptyBookmarkTree,
  flattenBookmarks,
  isBookmarkTreeEmpty,
  obsidianUriAction,
  parseBookmarkFile,
  pluginIcon,
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
      { name: "Section", url: "note://Work/Plan", kind: "note" }
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

  it("reads the link path out of a note URL", () => {
    expect(bookmarkLinkPath("note://Work/Brief")).toBe("Work/Brief");
  });
});

describe("bookmarkGlyph", () => {
  const bookmark = (kind: "web" | "obsidian" | "folder" | "note", url: string) => ({
    name: "B",
    url,
    kind
  });

  it("draws a web link with the bundled globe, whatever else is known", () => {
    expect(bookmarkGlyph(bookmark("web", "https://example.com"), "ignored")).toEqual({
      from: "bundled",
      name: "world"
    });
  });

  it("draws a plugin link with the plugin's icon, the vault's behind it", () => {
    expect(bookmarkGlyph(bookmark("obsidian", "obsidian://pythia?x=1"), "pythia-logo")).toEqual({
      from: "obsidian",
      names: ["pythia-logo", "library"],
      fallback: "external-link"
    });
  });

  it("draws everything else with the vault's icon", () => {
    expect(bookmarkGlyph(bookmark("note", "note://Brief"), null)).toEqual({
      from: "obsidian",
      names: ["library"],
      fallback: "file-text"
    });
    expect(bookmarkGlyph(bookmark("folder", "vault://Work"), null)).toEqual({
      from: "obsidian",
      names: ["library"],
      fallback: "folder"
    });
    expect(bookmarkGlyph(bookmark("obsidian", "obsidian://open?vault=V"), null)).toEqual({
      from: "obsidian",
      names: ["library"],
      fallback: "external-link"
    });
  });
});

describe("obsidianUriAction", () => {
  it("names the plugin action a URI calls", () => {
    expect(obsidianUriAction("obsidian://pythia?vault=Vault%202.0&cmd=resume&id=71b21d6b")).toBe(
      "pythia"
    );
    expect(obsidianUriAction("obsidian://Advanced-URI/?vault=x")).toBe("advanced-uri");
  });

  it("leaves the actions Obsidian answers itself alone", () => {
    expect(obsidianUriAction("obsidian://open?vault=Vault&file=Note")).toBeNull();
    expect(obsidianUriAction("obsidian://search?vault=Vault&query=x")).toBeNull();
    expect(obsidianUriAction("obsidian://vault/Vault/Note")).toBeNull();
  });

  it("says nothing about a URI without an action, or a link of another kind", () => {
    expect(obsidianUriAction("obsidian://?vault=x")).toBeNull();
    expect(obsidianUriAction("https://pythia.example")).toBeNull();
    expect(obsidianUriAction("note://pythia")).toBeNull();
  });
});

describe("pluginIcon", () => {
  const COMMANDS = [
    { id: "pythia:open", icon: "pythia-logo" },
    { id: "pythia:favorite", icon: "star" },
    { id: "pythia:new", icon: "pythia-logo" },
    { id: "pythia:regenerate", icon: "refresh-cw" },
    { id: "other:open", icon: "star" },
    { id: "other:new", icon: "star" }
  ];

  it("takes the plugin's ribbon button first", () => {
    const ribbon = [
      { id: "switcher:Open quick switcher", icon: "lucide-navigation" },
      { id: "pythia:Pythia", icon: "pythia-ribbon" }
    ];

    expect(pluginIcon({ ribbon, commands: COMMANDS }, "pythia")).toBe("pythia-ribbon");
  });

  it("falls back to its commands when it has no ribbon button", () => {
    const ribbon = [{ id: "other:Other", icon: "star" }];

    expect(pluginIcon({ ribbon, commands: COMMANDS }, "pythia")).toBe("pythia-logo");
    expect(pluginIcon({ commands: COMMANDS }, "pythia")).toBe("pythia-logo");
  });

  it("falls back to its commands when its ribbon button names no icon", () => {
    expect(
      pluginIcon({ ribbon: [{ id: "pythia:Pythia", icon: "" }], commands: COMMANDS }, "pythia")
    ).toBe("pythia-logo");
  });

  it("takes the icon named most, among several ribbon buttons as among commands", () => {
    const ribbon = [
      { id: "p:Settings", icon: "gear" },
      { id: "p:Open", icon: "logo" },
      { id: "p:New", icon: "logo" }
    ];

    expect(pluginIcon({ ribbon }, "p")).toBe("logo");
  });

  it("gives a tie to the one registered first", () => {
    expect(
      pluginIcon(
        {
          commands: [
            { id: "p:a", icon: "first" },
            { id: "p:b", icon: "second" }
          ]
        },
        "p"
      )
    ).toBe("first");
  });

  it("does not take another plugin's, even with a shared prefix", () => {
    expect(
      pluginIcon(
        {
          ribbon: [{ id: "pythia-extra:Open", icon: "star" }],
          commands: [{ id: "pythia-extra:open", icon: "star" }]
        },
        "pythia"
      )
    ).toBeNull();
  });

  it("ignores a missing, empty or malformed icon", () => {
    expect(
      pluginIcon(
        {
          commands: [{ id: "p:a" }, { id: "p:b", icon: "  " }, { id: "p:c", icon: 42 }]
        },
        "p"
      )
    ).toBeNull();
  });

  it("is null for a plugin that is not there, or with nothing to read", () => {
    expect(pluginIcon({ commands: COMMANDS }, "absent")).toBeNull();
    expect(pluginIcon({}, "pythia")).toBeNull();
  });
});
