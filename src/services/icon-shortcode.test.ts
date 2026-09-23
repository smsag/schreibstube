import { describe, expect, it } from "vitest";
import {
  completedShortcode,
  findShortcodes,
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

  it("does not mistake a time or a URL for a shortcode", () => {
    expect(findShortcodes("um 10:30:45 auf http://x", isIcon)).toEqual([]);
  });

  it("offsets survive a block that does not start at the top", () => {
    const text = "# Titel\n\nEin :alarm: am Morgen.";
    const [hit] = findShortcodes(text, isIcon);

    expect(text.slice(hit?.from, hit?.to)).toBe(":alarm:");
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
