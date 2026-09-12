import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_EXTENSIONS,
  FM_PUBLISHED,
  FM_SLUG,
  FM_TITLE,
  findSlugCollision,
  firstHeading,
  isInsideFolder,
  isPublishableAttachment,
  isoDate,
  readPublishFields,
  referencedAttachments,
  resolveNote,
  slugify,
  stripFrontmatter
} from "./publish-index";

/**
 * The plugin decides what is published and what each page is called, so a bug
 * here is a note published by accident or a link that does not resolve on a
 * public site.
 */

describe("readPublishFields", () => {
  it("treats a note with no frontmatter as not published", () => {
    expect(readPublishFields(undefined).published).toBe(false);
  });

  it("treats a note without the flag as not published, since silence must mean no", () => {
    expect(readPublishFields({ title: "Hallo" }).published).toBe(false);
  });

  it("reads the flag", () => {
    expect(readPublishFields({ [FM_PUBLISHED]: true }).published).toBe(true);
    expect(readPublishFields({ [FM_PUBLISHED]: false }).published).toBe(false);
  });

  it("accepts the spellings a person actually types", () => {
    for (const value of ["true", "yes", "ja", "TRUE", 1]) {
      expect(readPublishFields({ [FM_PUBLISHED]: value }).published).toBe(true);
    }
  });

  it("does not mistake other strings for consent", () => {
    for (const value of ["nein", "false", "", "vielleicht"]) {
      expect(readPublishFields({ [FM_PUBLISHED]: value }).published).toBe(false);
    }
  });

  it("trims the text fields", () => {
    expect(readPublishFields({ [FM_TITLE]: "  Hallo  " }).title).toBe("Hallo");
  });

  it("reads a date that Obsidian parsed into a Date", () => {
    expect(readPublishFields({ schreibstubeDate: new Date(2026, 8, 12) }).date).toBe("2026-09-12");
  });
});

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Hallo Welt")).toBe("hallo-welt");
  });

  it("transliterates umlauts the way the bridge does", () => {
    expect(slugify("Grundstück Größe")).toBe("grundstueck-groesse");
    expect(slugify("Straße")).toBe("strasse");
  });

  it("strips punctuation", () => {
    expect(slugify("Angebot: Objekt 4711!")).toBe("angebot-objekt-4711");
  });

  it("never returns something the bridge would refuse", () => {
    for (const value of ["!!!", "", "   ", "../etc/passwd"]) {
      expect(slugify(value)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("firstHeading", () => {
  it("finds the first heading of any level", () => {
    expect(firstHeading("## Zweite Ebene\n\nText")).toBe("Zweite Ebene");
  });

  it("ignores frontmatter that happens to contain a hash", () => {
    expect(firstHeading("---\ntags: ['#x']\n---\n\n# Echt\n")).toBe("Echt");
  });

  it("returns nothing when the note has no heading", () => {
    expect(firstHeading("Nur Text")).toBe("");
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading block", () => {
    expect(stripFrontmatter("---\na: 1\n---\nText")).toBe("Text");
  });

  it("leaves a horizontal rule alone", () => {
    expect(stripFrontmatter("Text\n\n---\n\nMehr")).toBe("Text\n\n---\n\nMehr");
  });
});

describe("resolveNote", () => {
  const base = {
    path: "Blog/Hallo Welt.md",
    basename: "Hallo Welt",
    content: "# Die Überschrift\n\nText",
    createdMs: new Date(2026, 8, 12).getTime(),
    frontmatter: {}
  };

  it("fills in everything the frontmatter left out", () => {
    expect(resolveNote(base)).toEqual({
      sourcePath: "Blog/Hallo Welt.md",
      slug: "hallo-welt",
      title: "Die Überschrift",
      date: "2026-09-12",
      description: undefined
    });
  });

  it("prefers the frontmatter title over the heading", () => {
    expect(resolveNote({ ...base, frontmatter: { [FM_TITLE]: "Anders" } }).title).toBe("Anders");
  });

  it("falls back to the filename when there is no heading", () => {
    expect(resolveNote({ ...base, content: "Nur Text" }).title).toBe("Hallo Welt");
  });

  it("slugifies a frontmatter slug rather than trusting it", () => {
    expect(resolveNote({ ...base, frontmatter: { [FM_SLUG]: "../Etc Passwd" } }).slug).toBe(
      "etc-passwd"
    );
  });

  it("uses the creation date when the note gives none", () => {
    expect(resolveNote(base).date).toBe("2026-09-12");
  });
});

describe("findSlugCollision", () => {
  const note = (sourcePath: string, slug: string) => ({
    sourcePath,
    slug,
    title: slug,
    date: "2026-01-01"
  });

  it("passes when every address is distinct", () => {
    expect(findSlugCollision([note("a.md", "a"), note("b.md", "b")])).toBeNull();
  });

  it("names both notes, since either could be the mistake", () => {
    const message = findSlugCollision([note("Blog/a.md", "x"), note("Blog/b.md", "x")]);
    expect(message).toContain("Blog/a.md");
    expect(message).toContain("Blog/b.md");
  });
});

describe("referencedAttachments", () => {
  it("finds embedded attachments", () => {
    expect(referencedAttachments("Text ![[bild.png]] mehr")).toEqual(["bild.png"]);
  });

  it("ignores the alias and the heading of an embed", () => {
    expect(referencedAttachments("![[bild.png|Das Haus]]")).toEqual(["bild.png"]);
  });

  it("finds Markdown images", () => {
    expect(referencedAttachments("![alt](assets/bild.png)")).toEqual(["assets/bild.png"]);
  });

  it("leaves a remote image where it is", () => {
    expect(referencedAttachments("![alt](https://example.com/x.png)")).toEqual([]);
  });

  it("lists each attachment once, however often it appears", () => {
    expect(referencedAttachments("![[a.png]] ![[a.png]]")).toEqual(["a.png"]);
  });

  it("ignores a plain wikilink, which is a page and not a file", () => {
    expect(referencedAttachments("[[Andere Notiz]]")).toEqual([]);
  });

  it("ignores anything in frontmatter", () => {
    expect(referencedAttachments("---\ncover: ![[geheim.png]]\n---\n\nText")).toEqual([]);
  });
});

describe("isPublishableAttachment", () => {
  it("accepts images and video", () => {
    expect(isPublishableAttachment("bild.PNG", ATTACHMENT_EXTENSIONS)).toBe(true);
    expect(isPublishableAttachment("clip.mp4", ATTACHMENT_EXTENSIONS)).toBe(true);
  });

  it("refuses everything else, because a site serves pictures and not payloads", () => {
    for (const name of ["notiz.md", "tabelle.xlsx", "skript.php", "ohne-endung"]) {
      expect(isPublishableAttachment(name, ATTACHMENT_EXTENSIONS)).toBe(false);
    }
  });
});

describe("isInsideFolder", () => {
  it("matches the folder and everything below it", () => {
    expect(isInsideFolder("Blog/a.md", "Blog")).toBe(true);
    expect(isInsideFolder("Blog/Unter/a.md", "Blog")).toBe(true);
  });

  it("does not match a folder that merely starts the same", () => {
    expect(isInsideFolder("Blogging/a.md", "Blog")).toBe(false);
  });

  it("treats an empty folder as the whole vault", () => {
    expect(isInsideFolder("irgendwo/a.md", "")).toBe(true);
  });

  it("tolerates slashes around the configured folder", () => {
    expect(isInsideFolder("Blog/a.md", "/Blog/")).toBe(true);
  });
});

describe("isoDate", () => {
  it("formats a calendar date in local time", () => {
    expect(isoDate(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
  });
});
