import { describe, expect, it } from "vitest";
import {
  completedShortcode,
  findShortcodes,
  iconLinkAt,
  isLinkLabel,
  MIN_TRIGGER_CHARS,
  rankIcons,
  shortcodeTrigger
} from "./icon-shortcode";

const ICONS = new Set(["folder", "folder-plus", "alarm", "key", "note"]);
const isIcon = (name: string): boolean => ICONS.has(name);

describe("findShortcodes", () => {
  it("finds a shortcode in prose, with absolute offsets", () => {
    const text = "Alles im :folder: ablegen.";

    expect(findShortcodes(text, isIcon)).toEqual([{ from: 9, to: 17, name: "folder" }]);
  });

  it("finds several, back to back", () => {
    const text = ":folder::key:";

    expect(findShortcodes(text, isIcon).map((hit) => hit.name)).toEqual(["folder", "key"]);
  });

  it("leaves a name the font does not have as text", () => {
    expect(findShortcodes("ein :smile: hier", isIcon)).toEqual([]);
  });

  it("leaves inline code alone", () => {
    expect(findShortcodes("schreibe `:folder:` um es zu zeigen", isIcon)).toEqual([]);
  });

  it("leaves a fenced code block alone", () => {
    const text = "Text\n\n```\n:folder:\n```\n\nText :key: Text";

    expect(findShortcodes(text, isIcon).map((hit) => hit.name)).toEqual(["key"]);
  });

  it("leaves a link's target alone", () => {
    expect(findShortcodes("[Ordner](https://example.org/:folder:)", isIcon)).toEqual([]);
  });

  it("finds one in a link's label", () => {
    const text = "## Werkzeugkasten [:folder:](https://example.org)";
    const [hit] = findShortcodes(text, isIcon);

    expect(text.slice(hit?.from, hit?.to)).toBe(":folder:");
  });

  it("finds one in a wikilink's alias, but not in its target or an embed's", () => {
    const text = "[[Ablage|:folder: Ablage]] [[Ziel#:key:]] ![[bild.png|:alarm:]]";

    expect(findShortcodes(text, isIcon).map((hit) => hit.name)).toEqual(["folder"]);
  });

  it("does not mistake a time or a URL for a shortcode", () => {
    expect(findShortcodes("um 10:30:45 auf http://x", isIcon)).toEqual([]);
  });

  it("offsets survive a block that does not start at the top", () => {
    const text = "# Titel\n\nEin :alarm: am Morgen.";
    const [hit] = findShortcodes(text, isIcon);

    expect(text.slice(hit?.from, hit?.to)).toBe(":alarm:");
  });
});

describe("iconLinkAt", () => {
  /** The link the first `:timeline:` in `line` stands in. */
  const linkOf = (line: string) => {
    const from = line.indexOf(":timeline:");
    return iconLinkAt(line, from, from + ":timeline:".length);
  };

  it("leads an icon in a link's words to its address", () => {
    expect(linkOf("[:timeline: ](http://www.smsag.de)")).toEqual({
      kind: "url",
      href: "http://www.smsag.de"
    });
    expect(linkOf('Siehe [:timeline: Plan](https://e.com/a "Titel") hier')).toEqual({
      kind: "url",
      href: "https://e.com/a"
    });
    expect(linkOf("[:timeline:](<https://e.com/a b>)")).toEqual({
      kind: "url",
      href: "https://e.com/a b"
    });
  });

  it("leads an icon in a link to a note, Markdown or wikilink, to that note", () => {
    expect(linkOf("[:timeline:](Mein%20Plan.md#Ziele)")).toEqual({
      kind: "note",
      target: "Mein Plan.md#Ziele"
    });
    expect(linkOf("[[Mein Plan|:timeline: Plan]]")).toEqual({ kind: "note", target: "Mein Plan" });
  });

  it("leads nowhere outside a link's words, or from an embed", () => {
    expect(linkOf(":timeline: [Plan](https://e.com)")).toBeNull();
    expect(linkOf("[Plan](https://e.com) :timeline:")).toBeNull();
    expect(linkOf("![:timeline:](bild.png)")).toBeNull();
    expect(linkOf("![[Bild|:timeline:]]")).toBeNull();
    expect(linkOf("[[Plan]] :timeline:")).toBeNull();
  });

  it("picks the link the icon is in when a line has several", () => {
    const line = "[a](https://one.example) und [:timeline:](https://two.example)";
    expect(linkOf(line)).toEqual({ kind: "url", href: "https://two.example" });
  });
});

describe("isLinkLabel", () => {
  it("is the words a person gave a link", () => {
    expect(isLinkLabel(":folder: Ablage", "https://x.de")).toBe(true);
    expect(isLinkLabel(":star:", "Ablage")).toBe(true);
  });

  it("is not the address a link shows, or nothing at all", () => {
    expect(isLinkLabel("https://x.de/:folder:", "https://x.de/:folder:")).toBe(false);
    expect(isLinkLabel("a:folder:@x.de", "mailto:a:folder:@x.de")).toBe(false);
    expect(isLinkLabel("www.x.de/:folder:", "http://www.x.de/:folder:")).toBe(false);
    expect(isLinkLabel("  ", null)).toBe(false);
  });
});

describe("shortcodeTrigger", () => {
  it("opens on a colon that begins a word, once two characters follow", () => {
    expect(shortcodeTrigger("Alles im :fo")).toEqual({ from: 9, query: "fo" });
    expect(shortcodeTrigger(":fo")).toEqual({ from: 0, query: "fo" });
  });

  it("waits for the second character", () => {
    expect(MIN_TRIGGER_CHARS).toBe(2);
    expect(shortcodeTrigger("im :f")).toBeNull();
    expect(shortcodeTrigger("im :")).toBeNull();
  });

  it("never opens on a colon that follows a word — that is prose", () => {
    expect(shortcodeTrigger("Beispiel:fo")).toBeNull();
    expect(shortcodeTrigger("Beispiel: der")).toBeNull();
  });

  it("closes the moment a space is typed", () => {
    expect(shortcodeTrigger("im :folder ")).toBeNull();
    expect(shortcodeTrigger("im :fol der")).toBeNull();
  });

  it("opens after an opening bracket or quote, where a word may begin", () => {
    expect(shortcodeTrigger("(:fo")).toEqual({ from: 1, query: "fo" });
    expect(shortcodeTrigger("„:fo")).toEqual({ from: 1, query: "fo" });
  });

  it("lowercases what was typed, since the names are lowercase", () => {
    expect(shortcodeTrigger("im :FoL")?.query).toBe("fol");
  });
});

describe("completedShortcode", () => {
  it("closes the colons and leaves a space to keep typing", () => {
    expect(completedShortcode("folder")).toBe(":folder: ");
  });
});

describe("rankIcons", () => {
  const names = ["alarm", "folder", "folder-plus", "key", "note"];

  it("puts names that start with the query before names that contain it", () => {
    expect(rankIcons(names, "ol", 10)).toEqual(["folder", "folder-plus"]);
    expect(rankIcons(names, "fo", 10)).toEqual(["folder", "folder-plus"]);
    expect(rankIcons([...names, "unfold"], "fo", 10)).toEqual(["folder", "folder-plus", "unfold"]);
  });

  it("stops at the limit", () => {
    expect(rankIcons(names, "", 2)).toEqual(["alarm", "folder"]);
  });
});
