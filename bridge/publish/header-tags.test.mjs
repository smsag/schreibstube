import { describe, expect, it } from "vitest";
import { planUploads, emptyManifest } from "./manifest.mjs";
import { isHeaderTag, tagLabel, tagPagePath } from "./path.mjs";
import { buildSite, checkIndex, headerNav, IndexError, sha256 } from "./site.mjs";

/**
 * Up to three tags linked from the site's header, each to a page of the notes
 * that carry it. The plugin decides which header tags a note carries; the
 * bridge checks that what it was told is consistent and draws the pages.
 */

const essay = "# Essay\n\nText.\n";
const alpha = "# Alpha\n\nText.\n";
const plain = "# Ohne\n\nText.\n";

function note(slug, source, tags, date = "2026-09-01") {
  return {
    sourcePath: `Blog/${slug}.md`,
    sha256: sha256(source),
    slug,
    title: slug,
    date,
    ...(tags ? { tags } : {})
  };
}

function index(overrides = {}) {
  return {
    siteTitle: "Grembl",
    headerTags: ["essay", "projekt", "leer"],
    notes: [
      note("essay", essay, ["essay"], "2026-09-10"),
      note("alpha", alpha, ["projekt", "essay"], "2026-09-20"),
      note("ohne", plain)
    ],
    assets: [],
    ...overrides
  };
}

const sources = new Map([
  [sha256(essay), essay],
  [sha256(alpha), alpha],
  [sha256(plain), plain]
]);

describe("header tags, as paths", () => {
  it("gives each tag a page of its own and names it by its last segment", () => {
    expect(tagPagePath("essay")).toBe("tag/essay/index.html");
    expect(tagPagePath("Projekt/Alpha")).toBe("tag/projekt-alpha/index.html");
    expect(tagLabel("projekt/alpha")).toBe("alpha");
    expect(tagLabel("essay")).toBe("essay");
  });

  it("draws only what it can name a page after", () => {
    expect(isHeaderTag("essay")).toBe(true);
    expect(isHeaderTag("projekt/alpha")).toBe(true);
    for (const bad of ["", "zwei wörter", "#essay", "a//b", "a\u0000b", 7, "x".repeat(101)]) {
      expect(isHeaderTag(bad)).toBe(false);
    }
  });
});

describe("checkIndex and header tags", () => {
  it("accepts an index without any, as every protocol-2 index is", () => {
    const older = { siteTitle: "Grembl", notes: [note("ohne", plain)], assets: [] };
    expect(() => checkIndex(older)).not.toThrow();
  });

  it("refuses more than three, one it cannot draw, and two that share a page", () => {
    expect(() => checkIndex(index({ headerTags: ["a", "b", "c", "d"] }))).toThrow(IndexError);
    expect(() => checkIndex(index({ headerTags: ["zwei wörter"] }))).toThrow(/Unusable header tag/);
    expect(() => checkIndex(index({ headerTags: ["a-b", "a/b"], notes: [] }))).toThrow(
      /share one page/
    );
    expect(() => checkIndex(index({ headerTags: "essay" }))).toThrow(IndexError);
  });

  it("refuses a note that names a tag the header does not have", () => {
    expect(() => checkIndex(index({ notes: [note("essay", essay, ["privat"])] }))).toThrow(
      /among the header tags/
    );
  });
});

describe("headerNav", () => {
  it("lists the tags some note carries, in the order set, each with its notes newest first", () => {
    const nav = headerNav(index());
    expect(nav.map((entry) => entry.tag)).toEqual(["essay", "projekt"]);
    expect(nav[0].notes.map((n) => n.slug)).toEqual(["alpha", "essay"]);
    expect(nav[1]).toMatchObject({
      label: "projekt",
      slug: "projekt",
      path: "tag/projekt/index.html"
    });
  });

  it("draws no header links when the connection sets none", () => {
    expect(headerNav({ notes: [], assets: [] })).toEqual([]);
  });
});

describe("the built site", () => {
  it("links the tags from every page's header and gives each its page", async () => {
    const files = await buildSite(index(), sources);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(["tag/essay/index.html", "tag/projekt/index.html"])
    );
    expect(files.has("tag/leer/index.html")).toBe(false);

    const start = files.get("index.html").toString();
    expect(start).toContain(
      '<nav class="site-tags" aria-label="Schlagwörter"><a href="tag/essay/">essay</a><a href="tag/projekt/">projekt</a></nav>'
    );
    expect(files.get("essay/index.html").toString()).toContain(
      '<a href="../tag/projekt/">projekt</a>'
    );
  });

  it("lists a tag's notes on its page, marks it in the header, and links back up", async () => {
    const page = (await buildSite(index(), sources)).get("tag/essay/index.html").toString();
    expect(page).toContain("<title>essay — Grembl</title>");
    expect(page).toContain('<h1 class="tag-title">essay</h1>');
    expect(page).toContain('<a href="../../tag/essay/" aria-current="page">essay</a>');
    expect(page).toContain('<a class="entry" href="../../alpha/">alpha</a>');
    expect(page).toContain('<a class="entry" href="../../essay/">essay</a>');
    expect(page).not.toContain("ohne");
    expect(page).toContain('<link rel="stylesheet" href="../../assets/theme.css">');
    expect(page).toContain('<header class="site"><a href="../../">Grembl</a>');
  });

  it("leaves the header as it was on a site without header tags", async () => {
    const files = await buildSite(
      { siteTitle: "Grembl", notes: [note("ohne", plain)], assets: [] },
      sources
    );
    expect(files.get("index.html").toString()).toContain('<header class="site">Grembl</header>');
    expect([...files.keys()].some((path) => path.startsWith("tag/"))).toBe(false);
  });

  it("escapes a tag's name, which comes from a note", async () => {
    const files = await buildSite(
      index({ headerTags: ["<b>"], notes: [note("essay", essay, ["<b>"])] }),
      sources
    );
    expect(files.get("index.html").toString()).toContain(">&lt;b&gt;</a>");
  });
});

describe("the plan and tag pages", () => {
  const published = (paths) => ({
    ...emptyManifest("blog"),
    files: Object.fromEntries(paths.map((path) => [path, { sha256: "x" }]))
  });

  it("keeps a tag page while a note carries the tag", () => {
    const plan = planUploads({
      index: index(),
      manifest: published(["tag/essay/index.html", "tag/projekt/index.html"]),
      storedSourceHashes: []
    });
    expect(plan.willDelete).toEqual([]);
  });

  it("lists a tag page for deletion once the tag leaves the header or its last note", () => {
    const plan = planUploads({
      index: index({ headerTags: ["essay"], notes: [note("essay", essay, ["essay"])] }),
      manifest: published(["tag/essay/index.html", "tag/projekt/index.html"]),
      storedSourceHashes: []
    });
    expect(plan.willDelete).toEqual(["tag/projekt/index.html"]);
  });
});
