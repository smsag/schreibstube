import { describe, expect, it } from "vitest";
import { buildSite, sha256 } from "./site.mjs";
import { awkwardVault, largeVault } from "./fixtures/vault.mjs";

/**
 * The rendered site, byte for byte.
 *
 * Substring assertions say a page mentions a link; they do not notice a layout
 * that quietly changed for every page on the site. Snapshots do, and rendering
 * is a pure function, so the diff is always a decision someone made.
 */

const { index, sources } = awkwardVault();

describe("the awkward vault", () => {
  it("renders every page and the index", async () => {
    const files = await buildSite(index, sources);
    const pages = [...files.keys()].filter((path) => path.endsWith(".html")).sort();

    expect(pages).toEqual([
      "diagramm/index.html",
      "eine-zeile/index.html",
      "grundstueck-groesse/index.html",
      "hallo-welt/index.html",
      "index.html",
      "notiz-mit-emoji/index.html",
      "ohne-titel/index.html"
    ]);
  });

  for (const slug of ["hallo-welt", "grundstueck-groesse", "notiz-mit-emoji", "diagramm"]) {
    it(`renders ${slug} exactly as it did`, async () => {
      const files = await buildSite(index, sources);
      expect(files.get(`${slug}/index.html`).toString()).toMatchSnapshot();
    });
  }

  it("renders the index page exactly as it did", async () => {
    const files = await buildSite(index, sources);
    expect(files.get("index.html").toString()).toMatchSnapshot();
  });

  it("keeps a comment out of the published bytes", async () => {
    const files = await buildSite(index, sources);
    for (const [path, content] of files) {
      if (!path.endsWith(".html")) continue;
      expect(content.toString()).not.toContain("darf nie erscheinen");
    }
  });

  it("gives a diagram page the bundle and leaves it off every other page", async () => {
    const files = await buildSite(index, sources);
    expect(files.get("diagramm/index.html").toString()).toContain("mermaid.min.js");
    expect(files.get("hallo-welt/index.html").toString()).not.toContain("mermaid.min.js");
  });

  it("renders nothing for a diagram when the target switched them off", async () => {
    const files = await buildSite(index, sources, { allowDiagrams: false });
    const page = files.get("diagramm/index.html").toString();
    // The fence renders as code, as any other language would, and the page
    // loads nothing.
    expect(page).not.toContain("mermaid.min.js");
    expect(page).not.toContain('<pre class="mermaid">');
    expect(page).toContain("flowchart LR");
  });

  it("escapes raw HTML when the target switched it off", async () => {
    const html = "---\npublished: true\n---\n\n# Titel\n\n<img src=x onerror=alert(1)>\n";
    const hash = sha256(html);
    const single = {
      siteTitle: "S",
      notes: [{ sourcePath: "a.md", sha256: hash, slug: "a", title: "Titel", date: "2026-01-01" }],
      assets: []
    };

    const files = await buildSite(single, new Map([[hash, html]]), { allowHtml: false });
    expect(files.get("a/index.html").toString()).toContain("&lt;img");
  });
});

describe("a large vault", () => {
  it("renders five hundred notes without the cost running away", async () => {
    const { index: many, sources: manySources } = largeVault(500);

    const started = Date.now();
    const files = await buildSite(many, manySources);
    const elapsed = Date.now() - started;

    expect(files.size).toBeGreaterThan(500);
    // A guard against an accidentally quadratic rendering pass rather than a
    // measurement: a linear render of this fixture takes about a second.
    expect(elapsed).toBeLessThan(20_000);
  }, 60_000);
});
