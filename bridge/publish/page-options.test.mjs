import { describe, expect, it } from "vitest";
import { emptyManifest, plannedOutputs, planUploads } from "./manifest.mjs";
import { createRenderer, renderMarkdown } from "./render/markdown.mjs";
import { videoPlayback } from "./render/obsidian.mjs";
import { formatDate } from "./render/page.mjs";
import { buildSite, checkIndex, isLanguageTag, sha256 } from "./site.mjs";

/**
 * What a site says about itself beyond its notes: the language each page is
 * in, a footer beneath every page, and how a video plays. Each is opt-in, and
 * a site that says none of it is built exactly as before.
 */

const start = "# Karussell\n\nSee [[Imprint]].\n";
const imprint = "# Impressum\n\nAngaben gemäß § 5 DDG.\n";
const footer = "© Karussell · [[Imprint]] · [[Karussell|Home]]\n";

function note(name, source, extra = {}) {
  return {
    sourcePath: `Site/${name}.md`,
    sha256: sha256(source),
    slug: name.toLowerCase(),
    title: name,
    date: "2026-10-01",
    ...extra
  };
}

function index(overrides = {}) {
  return {
    siteTitle: "Karussell",
    language: "en",
    notes: [
      note("Karussell", start, { home: true }),
      note("Imprint", imprint, { language: "de", date: "2026-10-02" }),
      note("Footer", footer, { footer: true })
    ],
    assets: [],
    ...overrides
  };
}

const sources = new Map([start, imprint, footer].map((source) => [sha256(source), source]));

async function site(overrides) {
  const files = await buildSite(checkIndex(index(overrides)), sources);
  return { paths: [...files.keys()], page: (path) => files.get(path)?.toString("utf8") };
}

describe("the language of a page", () => {
  it("takes the site's language, and a note's own where it has one", async () => {
    const { page } = await site();
    expect(page("index.html")).toContain('<html lang="en">');
    expect(page("imprint/index.html")).toContain('<html lang="de">');
  });

  it("stays German when nothing says otherwise", async () => {
    const notes = index().notes.map(({ language: _language, ...entry }) => entry);
    const { page } = await site({ language: undefined, notes });
    expect(page("index.html")).toContain('<html lang="de">');
    expect(page("imprint/index.html")).toContain('<html lang="de">');
  });

  it("writes the list's own words and dates in the page's language", async () => {
    const english = (await site({ homeList: true })).page("index.html");
    expect(english).toContain("2026-10-02");
    const german = (await site({ language: "de", homeList: true })).page("index.html");
    expect(german).toContain("02.10.2026");
    expect(formatDate("2026-10-02", "de-AT")).toBe("02.10.2026");
    expect(formatDate("2026-10-02", "en-GB")).toBe("2026-10-02");
    expect(formatDate("soon", "en")).toBe("");
  });

  it("names the tag links in the page's language", async () => {
    const tagged = index({
      headerTags: ["seite"],
      notes: index().notes.map((entry) => ({
        ...entry,
        tags: entry.footer ? undefined : ["seite"]
      }))
    });
    const files = await buildSite(checkIndex(tagged), sources);
    expect(files.get("index.html").toString()).toContain('aria-label="Tags"');
    expect(files.get("imprint/index.html").toString()).toContain('aria-label="Schlagwörter"');
  });

  it("accepts a language tag and nothing that could break the page", () => {
    for (const good of ["de", "en", "en-GB", "pt-BR", "zh-Hant-TW"]) {
      expect(isLanguageTag(good)).toBe(true);
    }
    for (const bad of ["", "e", 'de" onload="x', "deutsch", "de_DE", 7, "en-".repeat(20)]) {
      expect(isLanguageTag(bad)).toBe(false);
    }
    expect(() => checkIndex(index({ language: "english!" }))).toThrow(/Unusable language/);
    const notes = [note("Imprint", imprint, { language: "de-" })];
    expect(() => checkIndex(index({ notes }))).toThrow(/Site\/Imprint\.md: unusable language/);
  });
});

describe("a footer note", () => {
  it("is drawn beneath every page and has no page of its own", async () => {
    const { paths, page } = await site();
    expect(paths).not.toContain("footer/index.html");
    for (const path of ["index.html", "imprint/index.html"]) {
      const html = page(path);
      expect(html).toContain('<footer class="site">');
      expect(html.indexOf("</main>")).toBeLessThan(html.indexOf('<footer class="site">'));
    }
  });

  it("resolves its links from the page it is drawn on", async () => {
    const { page } = await site();
    const atRoot = page("index.html").slice(page("index.html").indexOf("<footer"));
    expect(atRoot).toContain('href="imprint/"');
    expect(atRoot).toContain('href="./"');
    const below = page("imprint/index.html").slice(page("imprint/index.html").indexOf("<footer"));
    expect(below).toContain('href="../imprint/"');
    expect(below).toContain('href="../"');
  });

  it("is left out of every list, and a link to it is plain text", async () => {
    const { page } = await site({ homeList: true });
    expect(page("index.html")).not.toContain(">Footer</a>");
    const linking = "# Karussell\n\nSee [[Footer]].\n";
    const files = await buildSite(
      checkIndex(
        index({ notes: [note("Karussell", linking, { home: true }), ...index().notes.slice(1)] })
      ),
      new Map([...sources, [sha256(linking), linking]])
    );
    expect(files.get("index.html").toString()).toContain("<p>See Footer.</p>");
  });

  it("gives a site without one the pages it always had", async () => {
    const notes = index().notes.filter((entry) => !entry.footer);
    const { page } = await site({ notes });
    expect(page("index.html")).not.toContain("<footer");
  });

  it("is one note, and never the start page as well", () => {
    const two = [...index().notes, note("Second", footer, { footer: true })];
    expect(() => checkIndex(index({ notes: two }))).toThrow(/Two notes claim the footer/);
    const both = [note("Karussell", start, { home: true, footer: true })];
    expect(() => checkIndex(index({ notes: both }))).toThrow(/not both/);
    const wrong = [note("Footer", footer, { footer: "yes" })];
    expect(() => checkIndex(index({ notes: wrong }))).toThrow(/footer must be true/);
  });

  it("asks for no page of its own, and lets an old one go", () => {
    const manifest = {
      ...emptyManifest("karussell"),
      files: { "index.html": { sha256: "x" }, "footer/index.html": { sha256: "x" } }
    };
    expect(planUploads({ index: index(), manifest, storedSourceHashes: [] }).willDelete).toEqual([
      "footer/index.html"
    ]);
    const outputs = plannedOutputs(index(), { uploadAssets: [], uploadThumbnails: [] });
    expect(outputs).not.toContain("footer/index.html");
  });
});

describe("how a video plays", () => {
  const md = createRenderer();
  const context = {
    notes: new Map(),
    assets: new Map([
      ["clip.mp4", { url: "../assets/bbb-clip.mp4", name: "clip.mp4", kind: "video" }]
    ]),
    slugify: (value) => value
  };
  const render = (source) => renderMarkdown(md, source, context).html;

  it("reads the words written where a picture's alt text goes", () => {
    expect(videoPlayback("loop")).toEqual({ loop: true, autoplay: true, muted: true });
    expect(videoPlayback("Autoplay")).toEqual({ loop: false, autoplay: true, muted: true });
    expect(videoPlayback("muted")).toEqual({ loop: false, autoplay: false, muted: true });
    expect(videoPlayback("Ein Film")).toEqual({ loop: false, autoplay: false, muted: false });
    expect(videoPlayback(undefined)).toEqual({ loop: false, autoplay: false, muted: false });
  });

  it("loops silently, keeping the controls so it can be stopped", () => {
    expect(render("![[clip.mp4|loop]]")).toContain(
      '<video class="embed" controls autoplay muted loop playsinline preload="auto" src="../assets/bbb-clip.mp4">'
    );
    expect(render("![loop](clip.mp4)")).toContain("autoplay muted loop playsinline");
  });

  it("plays once by itself, sized, when asked", () => {
    expect(render("![[clip.mp4|autoplay|640]]")).toContain(
      '<video class="embed" controls autoplay muted playsinline preload="auto" src="../assets/bbb-clip.mp4" width="640">'
    );
  });

  it("waits for a click, as before, when nothing is said", () => {
    expect(render("![[clip.mp4]]")).toContain(
      '<video class="embed" controls preload="metadata" src="../assets/bbb-clip.mp4">'
    );
  });
});
