import { describe, expect, it } from "vitest";
import { emptyManifest, plannedOutputs, planUploads } from "./manifest.mjs";
import { buildSite, checkIndex, IndexError, sha256 } from "./site.mjs";

/**
 * A note marked as home is the site's start page: its text is index.html, and
 * the list of notes appears beneath it only when the note asks for it. Without
 * such a note the start page is the list it always was.
 */

const start =
  "# Karussell\n\nEvery Space one glance away. See [[Datenschutz]] and ![[shot.png]].\n";
const privacy = "# Datenschutz\n\nBack to [[Karussell|the start]].\n";
const imprint = "# Impressum\n\nText.\n";

const shot = { sourcePath: "Site/shot.png", sha256: "a".repeat(64), name: "shot.png", bytes: 3 };

function note(slug, source, extra = {}) {
  return {
    sourcePath: `Site/${slug[0].toUpperCase()}${slug.slice(1)}.md`,
    sha256: sha256(source),
    slug,
    title: slug[0].toUpperCase() + slug.slice(1),
    ...extra
  };
}

function index(overrides = {}) {
  return {
    siteTitle: "Karussell",
    notes: [
      note("karussell", start, {
        home: true,
        date: "2026-10-01",
        description: "The Space switcher for Mac"
      }),
      note("datenschutz", privacy, { date: "2026-10-20" }),
      note("impressum", imprint, { date: "2026-10-10" })
    ],
    assets: [shot],
    ...overrides
  };
}

const sources = new Map([
  [sha256(start), start],
  [sha256(privacy), privacy],
  [sha256(imprint), imprint]
]);

async function site(overrides) {
  const files = await buildSite(checkIndex(index(overrides)), sources);
  return {
    paths: [...files.keys()],
    page: (path) => files.get(path)?.toString("utf8")
  };
}

describe("checking the start page in an index", () => {
  it("keeps the home flag, and nothing it does not know", () => {
    const checked = checkIndex(index({ homeList: true }));
    expect(checked).not.toHaveProperty("homeList");
    expect(checked.notes.find((entry) => entry.slug === "karussell").home).toBe(true);
    expect(checked.notes.find((entry) => entry.slug === "impressum")).not.toHaveProperty("home");
  });

  it("refuses two start pages, naming both notes", () => {
    const notes = index().notes.map((entry) => ({ ...entry, home: true }));
    expect(() => checkIndex(index({ notes }))).toThrow(IndexError);
    expect(() => checkIndex(index({ notes }))).toThrow(
      /Site\/Karussell\.md and Site\/Datenschutz\.md/
    );
  });

  it("accepts home only as true", () => {
    for (const home of [false, "true", 1]) {
      const notes = [note("karussell", start, { home })];
      expect(() => checkIndex(index({ notes }))).toThrow(/home must be true/);
    }
  });
});

describe("a site with a start page", () => {
  it("serves the note as index.html and nowhere else", async () => {
    const { paths, page } = await site();
    expect(paths).toContain("index.html");
    expect(paths).not.toContain("karussell/index.html");
    expect(paths).toContain("datenschutz/index.html");
    expect(page("index.html")).toContain("Every Space one glance away.");
  });

  it("names the page after the note, describes it, and gives it no date", async () => {
    const html = (await site()).page("index.html");
    expect(html).toContain("<title>Karussell</title>");
    expect(html).toContain('<meta name="description" content="The Space switcher for Mac">');
    expect(html).not.toContain('class="meta"');
    expect(html).toContain('<header class="site">Karussell</header>');
  });

  it("resolves its links and pictures from the site's root", async () => {
    const html = (await site()).page("index.html");
    expect(html).toContain('href="datenschutz/"');
    expect(html).toContain(`src="assets/${"a".repeat(12)}-shot.png"`);
    expect(html).not.toContain("../");
  });

  it("is where the other notes' links to it lead", async () => {
    expect((await site()).page("datenschutz/index.html")).toContain('href="../"');
  });

  it("is the note alone, with no list of notes", async () => {
    expect((await site()).page("index.html")).not.toContain('class="index"');
  });

  it("links a tag page's entry for it to the root", async () => {
    const tagged = index({
      headerTags: ["seite"],
      notes: index().notes.map((entry) => ({ ...entry, tags: ["seite"] }))
    });
    const files = await buildSite(checkIndex(tagged), sources);
    const html = files.get("tag/seite/index.html").toString("utf8");
    expect(html).toContain('<a class="entry" href="../../">Karussell</a>');
    expect(html).toContain('<a class="entry" href="../../impressum/">Impressum</a>');
  });
});

describe("a site without a start page", () => {
  it("keeps the list of notes as its start page", async () => {
    const notes = index().notes.map(({ home: _home, ...entry }) => entry);
    const { paths, page } = await site({ notes });
    expect(paths).toContain("karussell/index.html");
    expect(page("index.html")).toContain('<ul class="index">');
  });
});

describe("planning around a start page", () => {
  it("takes down the note's old page once it becomes the start page", () => {
    const manifest = {
      ...emptyManifest("karussell"),
      files: {
        "index.html": { sha256: "x" },
        "karussell/index.html": { sha256: "x" },
        "impressum/index.html": { sha256: "x" }
      }
    };
    const plan = planUploads({ index: index(), manifest, storedSourceHashes: [] });
    expect(plan.willDelete).toEqual(["karussell/index.html"]);
  });

  it("names index.html, not the note's slug, among the outputs", () => {
    const outputs = plannedOutputs(index(), { uploadAssets: [], uploadThumbnails: [] });
    expect(outputs).toContain("index.html");
    expect(outputs).not.toContain("karussell/index.html");
  });
});
