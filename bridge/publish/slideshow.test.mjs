import { describe, expect, it } from "vitest";
import { createRenderer, renderMarkdown } from "./render/markdown.mjs";
import { notePage } from "./render/page.mjs";
import { parseSlideshow, regionLabel, renderSlideshow } from "./render/slideshow.mjs";
import { buildSite, sha256 } from "./site.mjs";

const md = createRenderer();

const ASSETS = new Map([
  ["a.png", { url: "../assets/aaa-a.png", name: "a.png", kind: "image" }],
  ["b.png", { url: "../assets/bbb-b.png", name: "b.png", kind: "image" }],
  ["c.png", { url: "../assets/ccc-c.png", name: "c.png", kind: "image" }],
  ["my photo.png", { url: "../assets/ddd-my-photo.png", name: "my photo.png", kind: "image" }],
  ["texte/bilder/haus.png", { url: "../assets/eee-haus.png", name: "haus.png", kind: "image" }],
  ["clip.mp4", { url: "../assets/fff-clip.mp4", name: "clip.mp4", kind: "video" }]
]);

const site = { notes: new Map(), assets: ASSETS, slugify: (value) => value };
const resolve = (src) => ASSETS.get(src.toLowerCase());

function render(source, sourcePath = "") {
  return renderMarkdown(md, source, site, { sourcePath });
}

const block = (...lines) => "```schreibstube-slideshow\n" + lines.join("\n") + "\n```\n";

describe("parseSlideshow", () => {
  it("names the line it could not read", () => {
    expect(parseSlideshow("![a](a.png)\nFoto")).toEqual({
      ok: false,
      line: 2,
      reason: "not-image"
    });
    expect(parseSlideshow("layout: karussell\n![a](a.png)")).toMatchObject({
      line: 1,
      reason: "layout"
    });
    expect(parseSlideshow("![a]( )\n![b](b.png)")).toMatchObject({ line: 1, reason: "empty-path" });
  });
});

describe("renderSlideshow", () => {
  it("writes a labelled figure with every published picture", () => {
    const { html, slideshow } = renderSlideshow("![Eins](a.png)\n![Zwei](b.png)", resolve);
    expect(slideshow).toBe(true);
    expect(html).toContain(
      '<figure class="slideshow slideshow-slideshow" data-layout="slideshow" role="group" aria-label="Diaschau, 2 Bilder">'
    );
    expect(html).toContain('<img src="../assets/aaa-a.png" alt="Eins" decoding="async">');
    expect(html).toContain('<img src="../assets/bbb-b.png" alt="Zwei" loading="lazy"');
  });

  it("fetches the picture a stage or a feature opens on with the page, and the rest later", () => {
    const eager = (layout) =>
      renderSlideshow(`layout: ${layout}\n![](a.png)\n![](b.png)\n![](c.png)`, resolve).html.match(
        /<img(?![^>]*loading="lazy")[^>]*>/g
      ) ?? [];
    for (const layout of ["slideshow", "filmstrip", "feature"]) {
      expect(eager(layout)).toEqual([expect.stringContaining("aaa-a.png")]);
    }
    for (const layout of ["strip", "masonry", "compare"]) {
      expect(eager(layout)).toEqual([]);
    }
  });

  it("gives a strip its column count", () => {
    const five = Array.from({ length: 5 }, () => "![](a.png)").join("\n");
    expect(renderSlideshow(`layout: strip\n${five}`, resolve).html).toContain(
      'style="--slideshow-columns: 3"'
    );
  });

  it("shows a feature's first three and a comparison's first two", () => {
    const four = "![](a.png)\n![](b.png)\n![](c.png)\n![](a.png)";
    expect(renderSlideshow(`layout: feature\n${four}`, resolve).html.match(/<img/g)).toHaveLength(
      3
    );
    expect(renderSlideshow(`layout: compare\n${four}`, resolve).html.match(/<img/g)).toHaveLength(
      2
    );
  });

  it("labels the two sides of a comparison with their alt text", () => {
    const { html } = renderSlideshow(
      "layout: compare\n![Vorher](a.png)\n![Nachher](b.png)",
      resolve
    );
    // Shown to the eye; a screen reader has the same words from the alt text.
    expect(html).toContain('<span class="slideshow-label" aria-hidden="true">Vorher</span>');
    expect(html).toContain('<span class="slideshow-label" aria-hidden="true">Nachher</span>');
    expect(html).toContain('alt="Vorher"');
  });

  it("leaves out a picture the site does not have, and a video", () => {
    const { html } = renderSlideshow(
      "![](a.png)\n![](fehlt.png)\n![](https://example.com/x.png)\n![](clip.mp4)\n![](b.png)",
      resolve
    );
    expect(html.match(/<img/g)).toHaveLength(2);
    expect(html).toContain("Diaschau, 2 Bilder");
    expect(html).not.toContain("fehlt");
    expect(html).not.toContain("example.com");
  });

  it("shows one remaining picture as a picture, and none as nothing", () => {
    const one = renderSlideshow("![Eins](a.png)\n![](fehlt.png)", resolve);
    expect(one).toEqual({
      html: '<p><img src="../assets/aaa-a.png" alt="Eins" loading="lazy" decoding="async"></p>\n',
      slideshow: false
    });
    expect(renderSlideshow("![](x.png)\n![](y.png)", resolve)).toEqual({
      html: "",
      slideshow: false
    });
  });

  it("leaves a block the plugin refuses off the page", () => {
    expect(renderSlideshow("![a](a.png)\nFoto", resolve)).toEqual({ html: "", slideshow: false });
  });

  it("escapes alt text, which is note text", () => {
    const { html } = renderSlideshow(
      'layout: compare\n![<script>"x"</script>](a.png)\n![b](b.png)',
      resolve
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  });

  it("names each layout the way the plugin does", () => {
    expect(regionLabel("feature", 3)).toBe("Szene mit Details, 3 Bilder");
    expect(regionLabel("strip", 4)).toBe("Bildreihe, 4 Bilder");
    expect(regionLabel("filmstrip", 5)).toBe("Diaschau mit Vorschaubildern, 5 Bilder");
    expect(regionLabel("masonry", 6)).toBe("Bilderwand, 6 Bilder");
    expect(regionLabel("compare", 2)).toBe("Vorher und nachher");
    expect(regionLabel("slideshow", 2)).toBe("Diaschau, 2 Bilder");
  });
});

describe("a slideshow in a note", () => {
  it("replaces the code block, and says the page needs the slideshow's files", () => {
    const result = render(block("![Eins](a.png)", "![Zwei](b.png)"));
    expect(result.html).toContain('<figure class="slideshow');
    expect(result.html).not.toContain("<code");
    expect(result.usedSlideshow).toBe(true);
  });

  it("finds a path in angle brackets, with %20, or relative to the note", () => {
    const { html } = render(
      block("![](<my photo.png>)", "![](my%20photo.png)", "![](bilder/haus.png)"),
      "Texte/Beitrag.md"
    );
    expect(html.match(/ddd-my-photo\.png/g)).toHaveLength(2);
    expect(html).toContain("eee-haus.png");
  });

  it("does not ask for the files when nothing was drawn", () => {
    expect(render(block("![a](a.png)", "Foto")).usedSlideshow).toBe(false);
    expect(render("Nur Text.").usedSlideshow).toBe(false);
  });

  it("loads the stylesheet and the script on that page only", () => {
    const note = { title: "T", date: "", description: "" };
    const withShow = notePage({ note, body: "", siteTitle: "S", usedSlideshow: true });
    expect(withShow).toContain('<link rel="stylesheet" href="../assets/slideshow.css">');
    expect(withShow).toContain('<script type="module" src="../assets/slideshow.js"></script>');
    const without = notePage({ note, body: "", siteTitle: "S" });
    expect(without).not.toContain("slideshow");
  });
});

describe("buildSite", () => {
  const withShow = block("![Eins](Bilder/a.png)", "![Zwei](Bilder/b.png)");
  const plain = "Nur Text.\n";
  const note = (source, slug) => ({
    sourcePath: `Blog/${slug}.md`,
    sha256: sha256(source),
    slug,
    title: slug,
    date: "2026-09-24"
  });
  const assets = ["a", "b"].map((name, i) => ({
    sourcePath: `Blog/Bilder/${name}.png`,
    sha256: String(i + 1).repeat(64),
    name: `${name}.png`
  }));

  it("writes the slideshow's files only when a page uses them", async () => {
    const files = await buildSite(
      { siteTitle: "S", notes: [note(withShow, "show")], assets },
      new Map([[sha256(withShow), withShow]])
    );
    expect(files.get("assets/slideshow.css").toString()).toContain(".slideshow");
    expect(files.get("assets/slideshow.js").toString()).toContain("export function enhance");
    expect(files.get("show/index.html").toString()).toMatch(
      /<img src="\.\.\/assets\/1+-a\.png" alt="Eins"/
    );

    const bare = await buildSite(
      { siteTitle: "S", notes: [note(plain, "text")], assets: [] },
      new Map([[sha256(plain), plain]])
    );
    expect(bare.has("assets/slideshow.js")).toBe(false);
    expect(bare.has("assets/slideshow.css")).toBe(false);
  });
});
