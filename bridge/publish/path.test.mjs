import { describe, expect, it } from "vitest";
import {
  MAX_SEGMENT_BYTES,
  PathError,
  assetPath,
  checkRelativePath,
  directoriesFor,
  extensionOf,
  isValidSlug,
  joinRemote,
  pagePath,
  slugify
} from "./path.mjs";

/**
 * The bridge is a remote file writer, so these rules are the difference between
 * publishing a site and rearranging someone's server. They get more tests than
 * anything else in the capability.
 */

describe("checkRelativePath", () => {
  it("accepts an ordinary output path", () => {
    expect(checkRelativePath("hallo-welt/index.html")).toBe("hallo-welt/index.html");
  });

  for (const path of [
    "../etc/passwd.html",
    "a/../../b.html",
    "..",
    "a/../b.html",
    "a/./b.html"
  ]) {
    it(`refuses traversal: ${path}`, () => {
      expect(() => checkRelativePath(path)).toThrow(PathError);
    });
  }

  it("refuses an absolute path", () => {
    expect(() => checkRelativePath("/etc/nginx/nginx.html")).toThrow(/relative/);
  });

  it("refuses a Windows-style separator, which some servers treat as one", () => {
    expect(() => checkRelativePath("a\\b.html")).toThrow(/backslash/);
  });

  it("refuses control characters", () => {
    expect(() => checkRelativePath("a\u0007b.html")).toThrow(/control/);
  });

  it("refuses an empty segment", () => {
    expect(() => checkRelativePath("a//b.html")).toThrow(PathError);
  });

  it("refuses a segment longer than a filesystem allows", () => {
    expect(() => checkRelativePath(`${"x".repeat(MAX_SEGMENT_BYTES + 1)}.html`)).toThrow(/segment/);
  });

  it("counts bytes rather than characters, since the limit is a filesystem one", () => {
    expect(() => checkRelativePath(`${"ä".repeat(200)}.html`)).toThrow(/segment/);
  });

  it("refuses a path with no extension", () => {
    expect(() => checkRelativePath("hallo-welt/index")).toThrow(/Extension/);
  });

  it("refuses an extension the site does not serve", () => {
    expect(() => checkRelativePath("script.php")).toThrow(/Extension/);
  });

  it("narrows to the extensions a caller allows", () => {
    const extensions = new Set(["png"]);
    expect(checkRelativePath("assets/x.png", { extensions })).toBe("assets/x.png");
    expect(() => checkRelativePath("assets/x.html", { extensions })).toThrow(/Extension/);
  });

  it("refuses an empty path", () => {
    expect(() => checkRelativePath("")).toThrow(PathError);
  });
});

describe("joinRemote", () => {
  it("joins onto a root", () => {
    expect(joinRemote("/var/www/blog", "a/b.html")).toBe("/var/www/blog/a/b.html");
  });

  it("tolerates a trailing slash on the root", () => {
    expect(joinRemote("/var/www/blog/", "a.html")).toBe("/var/www/blog/a.html");
  });

  it("validates before joining, so nothing can climb out of the root", () => {
    expect(() => joinRemote("/var/www/blog", "../../etc/passwd.html")).toThrow(PathError);
  });
});

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Hallo Welt")).toBe("hallo-welt");
  });

  it("transliterates umlauts rather than dropping them", () => {
    expect(slugify("Grundstück Größe")).toBe("grundstueck-groesse");
    expect(slugify("Straße")).toBe("strasse");
  });

  it("strips punctuation and collapses the gaps", () => {
    expect(slugify("Angebot: Objekt 4711 — final!")).toBe("angebot-objekt-4711-final");
  });

  it("never starts or ends with a dash", () => {
    expect(slugify("  --Hallo--  ")).toBe("hallo");
  });

  it("falls back rather than returning nothing", () => {
    expect(slugify("!!!")).toBe("datei");
    expect(slugify("")).toBe("datei");
  });

  it("produces something a path check accepts", () => {
    expect(isValidSlug(slugify("Ein sehr schöner Beitrag"))).toBe(true);
  });
});

describe("isValidSlug", () => {
  it("accepts what slugify produces", () => {
    expect(isValidSlug("hallo-welt-2")).toBe(true);
  });

  for (const slug of ["Hallo", "hallo welt", "hallo/welt", "-hallo", "hallo-", "..", ""]) {
    it(`rejects ${JSON.stringify(slug)}`, () => {
      expect(isValidSlug(slug)).toBe(false);
    });
  }

  it("rejects a slug that would make an unreasonable directory name", () => {
    expect(isValidSlug("a".repeat(81))).toBe(false);
  });
});

describe("assetPath", () => {
  it("is content-addressed, so changed content cannot be served from a cache", () => {
    expect(assetPath("a".repeat(64), "bild.png")).toBe("assets/aaaaaaaaaaaa-bild.png");
    expect(assetPath("b".repeat(64), "bild.png")).not.toBe(assetPath("a".repeat(64), "bild.png"));
  });

  it("keeps the name readable but never usable as a path", () => {
    expect(assetPath("a".repeat(64), "../../etc/passwd.png")).toBe(
      "assets/aaaaaaaaaaaa-etc-passwd.png"
    );
  });

  it("lowercases the extension", () => {
    expect(assetPath("a".repeat(64), "Bild.PNG")).toBe("assets/aaaaaaaaaaaa-bild.png");
  });

  it("survives a name that is nothing but punctuation", () => {
    expect(assetPath("a".repeat(64), "!!!.png")).toBe("assets/aaaaaaaaaaaa-datei.png");
  });

  it("produces a path the checker accepts", () => {
    const path = assetPath("a".repeat(64), "Mein Bild.jpeg");
    expect(checkRelativePath(path, { extensions: new Set(["jpeg"]) })).toBe(path);
  });
});

describe("pagePath", () => {
  it("serves a note as a directory index, for a clean URL", () => {
    expect(pagePath("hallo-welt")).toBe("hallo-welt/index.html");
  });

  it("refuses a slug that did not come from slugify", () => {
    expect(() => pagePath("../etc")).toThrow(PathError);
  });
});

describe("extensionOf", () => {
  it("reads the last extension, lowercased", () => {
    expect(extensionOf("Bild.tar.GZ")).toBe("gz");
  });

  it("returns nothing for a name without one", () => {
    expect(extensionOf("README")).toBe("");
  });
});

describe("directoriesFor", () => {
  it("lists every directory a set of files needs, shallowest first", () => {
    expect(directoriesFor(["a/b/c.html", "a/d.html", "e.html"])).toEqual(["a", "a/b"]);
  });

  it("returns nothing when every file is at the root", () => {
    expect(directoriesFor(["index.html"])).toEqual([]);
  });
});
