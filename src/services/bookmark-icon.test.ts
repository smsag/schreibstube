import { describe, expect, it } from "vitest";
import { bookmarkGlyph, obsidianUriAction, pluginIcon } from "./bookmark-icon";

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
