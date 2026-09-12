import { describe, expect, it } from "vitest";
import {
  createRenderer,
  renderMarkdown,
  stripComments,
  stripFrontmatter
} from "./render/markdown.mjs";
import { formatDate, indexPage, notePage } from "./render/page.mjs";
import { buildSite, checkIndex, orderNotes, sha256 } from "./site.mjs";

/**
 * Rendering moved to the bridge to become a pure function of source and index.
 * These tests are the return on that: the same input, the same bytes, checked
 * without a vault, a browser or a network.
 */

const md = createRenderer();

function site({ notes = [], assets = [] } = {}) {
  return {
    notes: new Map(notes.map((note) => [note.key, note])),
    assets: new Map(assets.map((asset) => [asset.key, asset])),
    slugify: (value) => value.toLowerCase().replace(/\s+/g, "-")
  };
}

function render(source, context = site()) {
  return renderMarkdown(md, source, context).html;
}

describe("frontmatter and comments", () => {
  it("removes frontmatter, which is metadata and not content", () => {
    expect(stripFrontmatter("---\npublished: true\n---\n# Titel\n")).toBe("# Titel\n");
  });

  it("leaves a horizontal rule alone", () => {
    expect(stripFrontmatter("Text\n\n---\n\nMehr")).toBe("Text\n\n---\n\nMehr");
  });

  it("removes comments rather than hiding them, since view-source is one click", () => {
    expect(stripComments("Sichtbar %% geheim %% weiter")).toBe("Sichtbar  weiter");
  });

  it("removes a comment spanning several lines", () => {
    expect(stripComments("a\n%%\nnotiz\n%%\nb")).toBe("a\n\nb");
  });

  it("keeps frontmatter out of the rendered page", () => {
    expect(render("---\nsecret: 42\n---\n\nText")).not.toContain("42");
  });
});

describe("wikilinks", () => {
  const context = site({
    notes: [{ key: "zweite notiz", url: "../zweite/", title: "Zweite Notiz", slug: "zweite" }]
  });

  it("links a published note by name", () => {
    expect(render("[[Zweite Notiz]]", context)).toContain('<a href="../zweite/" class="internal">');
  });

  it("uses the alias when one is given", () => {
    expect(render("[[Zweite Notiz|hier]]", context)).toContain(">hier</a>");
  });

  it("ignores case, because a wikilink is written as it reads", () => {
    expect(render("[[zweite notiz]]", context)).toContain('href="../zweite/"');
  });

  it("keeps a heading as a fragment", () => {
    expect(render("[[Zweite Notiz#Ein Abschnitt]]", context)).toContain(
      'href="../zweite/#ein-abschnitt"'
    );
  });

  it("degrades a link to an unpublished note to plain text", () => {
    const html = render("Siehe [[Nicht Veröffentlicht]] dazu.", context);
    expect(html).toContain("Nicht Veröffentlicht");
    expect(html).not.toContain("<a ");
  });

  it("leaves an ordinary Markdown link alone", () => {
    expect(render("[Text](https://example.com)", context)).toContain('href="https://example.com"');
  });

  it("marks an outbound link so a new tab cannot reach back", () => {
    expect(render("[Text](https://example.com)", context)).toContain('rel="noopener"');
  });

  it("leaves an unterminated wikilink as written", () => {
    expect(render("[[offen", context)).toContain("[[offen");
  });
});

describe("embeds", () => {
  const context = site({
    notes: [{ key: "andere", url: "../andere/", title: "Andere", slug: "andere" }],
    assets: [
      { key: "bild.png", url: "../assets/aaa-bild.png", name: "bild.png", kind: "image" },
      { key: "clip.mp4", url: "../assets/bbb-clip.mp4", name: "clip.mp4", kind: "video" }
    ]
  });

  it("renders an embedded image with its content-addressed source", () => {
    const html = render("![[bild.png]]", context);
    expect(html).toContain('src="../assets/aaa-bild.png"');
    expect(html).toContain('loading="lazy"');
  });

  it("gives an image alt text, since an empty alt is an accessibility bug", () => {
    expect(render("![[bild.png]]", context)).toContain('alt="bild.png"');
    expect(render("![[bild.png|Das Haus]]", context)).toContain('alt="Das Haus"');
  });

  it("renders an embedded video as a player rather than a broken image", () => {
    expect(render("![[clip.mp4]]", context)).toContain("<video");
  });

  it("links an embedded note instead of inlining it", () => {
    expect(render("![[Andere]]", context)).toContain('<a href="../andere/"');
  });

  it("degrades an embed of something that was not published", () => {
    expect(render("![[fehlt.png]]", context)).toContain("fehlt.png");
  });
});

describe("callouts", () => {
  it("keeps a plain blockquote plain", () => {
    expect(render("> Nur ein Zitat")).toContain("<blockquote>");
  });

  it("turns a callout into a titled block", () => {
    const html = render("> [!warning] Achtung\n> Der Text.");
    expect(html).toContain('class="callout callout-warning"');
    expect(html).toContain('<p class="callout-title">Achtung</p>');
  });

  it("uses the type as the title when none is given", () => {
    expect(render("> [!note]\n> Text.")).toContain(">Note</p>");
  });

  it("renders the body once", () => {
    const html = render("> [!note] Titel\n> Genau einmal.");
    expect(html.match(/Genau einmal/g)).toHaveLength(1);
  });

  it("still renders Markdown inside the callout", () => {
    expect(render("> [!note] T\n> Mit **Fett**.")).toContain("<strong>Fett</strong>");
  });

  it("folds a collapsible callout without any JavaScript", () => {
    const html = render("> [!tip]- Später\n> Versteckt.");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Später</summary>");
    expect(html).toContain("</details>");
    expect(html).not.toContain("<blockquote");
  });

  it("opens a callout marked with a plus", () => {
    expect(render("> [!tip]+ Offen\n> Text.")).toContain(
      '<details class="callout callout-tip" open>'
    );
  });

  it("escapes a title rather than letting it close the tag", () => {
    expect(render("> [!note] <img src=x onerror=alert(1)>\n> Text.")).toContain("&lt;img");
  });
});

describe("the rest of the syntax", () => {
  it("renders tables", () => {
    expect(render("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table>");
  });

  it("renders footnotes", () => {
    expect(render("Text.[^1]\n\n[^1]: Die Fussnote.")).toContain("footnote");
  });

  it("renders task lists as checkboxes", () => {
    expect(render("- [x] erledigt")).toContain('type="checkbox"');
  });

  it("renders highlights, subscript and superscript", () => {
    expect(render("==wichtig==")).toContain("<mark>");
    expect(render("H~2~O")).toContain("<sub>");
    expect(render("E=mc^2^")).toContain("<sup>");
  });

  it("renders definition lists", () => {
    expect(render("Begriff\n: Die Erklärung")).toContain("<dl>");
  });

  it("gives headings an id, so a wikilink fragment lands somewhere", () => {
    expect(render("## Ein Abschnitt")).toContain('id="ein-abschnitt"');
  });

  it("renders maths to static HTML with no client-side script", () => {
    const result = renderMarkdown(md, "Die Formel $E=mc^2$.", site());
    expect(result.usedMath).toBe(true);
    expect(result.html).toContain("katex");
  });

  it("leaves a diagram to the client, and says the page needs the bundle", () => {
    const result = renderMarkdown(md, "```mermaid\nflowchart LR\n A-->B\n```", site());
    expect(result.usedMermaid).toBe(true);
    expect(result.html).toContain('<pre class="mermaid">');
    expect(result.html).toContain("A--&gt;B");
  });

  it("renders an ordinary fence as code", () => {
    expect(render("```ts\nconst a = 1;\n```")).toContain("<code");
  });
});

describe("pages", () => {
  const note = { title: "Hallo", slug: "hallo", date: "2026-09-12", description: "Kurz" };

  it("formats a date the way it is read in German, without locale data", () => {
    expect(formatDate("2026-09-12")).toBe("12.09.2026");
    expect(formatDate("")).toBe("");
  });

  it("links assets relative to the page, so a subdirectory site works", () => {
    const html = notePage({ note, body: "<p>x</p>", siteTitle: "S" });
    expect(html).toContain('href="../assets/theme.css"');
  });

  it("loads the maths stylesheet only where there is maths", () => {
    expect(notePage({ note, body: "", siteTitle: "S", usedMath: true })).toContain("katex.css");
    expect(notePage({ note, body: "", siteTitle: "S", usedMath: false })).not.toContain(
      "katex.css"
    );
  });

  it("loads the diagram bundle only where there is a diagram", () => {
    expect(notePage({ note, body: "", siteTitle: "S", usedMermaid: true })).toContain(
      "mermaid.min.js"
    );
    expect(notePage({ note, body: "", siteTitle: "S", usedMermaid: false })).not.toContain(
      "mermaid"
    );
  });

  it("adds the title as a heading", () => {
    expect(notePage({ note, body: "<p>x</p>", siteTitle: "S" })).toContain("<h1>Hallo</h1>");
  });

  it("does not print the title twice when the note opens with its own heading", () => {
    const html = notePage({ note, body: '<h1 id="hallo">Hallo</h1>\n', siteTitle: "S" });
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("lists notes on the index page", () => {
    const html = indexPage({ notes: [note], siteTitle: "S" });
    expect(html).toContain('href="hallo/"');
    expect(html).toContain("Kurz");
  });

  it("says so when there is nothing published yet", () => {
    expect(indexPage({ notes: [], siteTitle: "S" })).toContain("Noch nichts");
  });
});

describe("the index", () => {
  const hash = (value) => sha256(value);

  function note(overrides) {
    return {
      sourcePath: "Blog/a.md",
      sha256: hash("a"),
      slug: "a",
      title: "A",
      date: "2026-01-01",
      ...overrides
    };
  }

  it("refuses two notes claiming the same address", () => {
    expect(() =>
      checkIndex({
        notes: [note({}), note({ sourcePath: "Blog/b.md", sha256: hash("b") })],
        assets: []
      })
    ).toThrow(/claim the slug/);
  });

  it("names both notes in the collision, since either could be the mistake", () => {
    try {
      checkIndex({ notes: [note({}), note({ sourcePath: "Blog/b.md" })], assets: [] });
    } catch (err) {
      expect(err.message).toContain("Blog/a.md");
      expect(err.message).toContain("Blog/b.md");
    }
  });

  it("refuses a slug that did not come from slugify", () => {
    expect(() => checkIndex({ notes: [note({ slug: "../etc" })], assets: [] })).toThrow(/slug/);
  });

  it("refuses a note with no content hash", () => {
    expect(() => checkIndex({ notes: [note({ sha256: "kurz" })], assets: [] })).toThrow(/hash/);
  });

  it("orders newest first, and stays stable within a day", () => {
    const ordered = orderNotes([
      { title: "B", date: "2026-01-01" },
      { title: "C", date: "2026-03-01" },
      { title: "A", date: "2026-01-01" }
    ]);
    expect(ordered.map((entry) => entry.title)).toEqual(["C", "A", "B"]);
  });
});

describe("buildSite", () => {
  const source = "# Titel\n\nText mit [[Zweite]].\n";
  const second = "# Zweite\n";

  const index = {
    siteTitle: "Schreibstube",
    notes: [
      {
        sourcePath: "Blog/Erste.md",
        sha256: sha256(source),
        slug: "erste",
        title: "Erste",
        date: "2026-09-12"
      },
      {
        sourcePath: "Blog/Zweite.md",
        sha256: sha256(second),
        slug: "zweite",
        title: "Zweite",
        date: "2026-09-01"
      }
    ],
    assets: []
  };

  const sources = new Map([
    [sha256(source), source],
    [sha256(second), second]
  ]);

  it("builds a page per note plus an index and a stylesheet", async () => {
    const files = await buildSite(index, sources);
    expect([...files.keys()].sort()).toEqual([
      "assets/theme.css",
      "erste/index.html",
      "index.html",
      "zweite/index.html"
    ]);
  });

  it("resolves links between notes", async () => {
    const files = await buildSite(index, sources);
    expect(files.get("erste/index.html").toString()).toContain('href="../zweite/"');
  });

  it("is deterministic, which is the reason rendering lives here", async () => {
    const first = await buildSite(index, sources);
    const second = await buildSite(index, sources);
    for (const [path, content] of first) {
      expect(sha256(content)).toBe(sha256(second.get(path)));
    }
  });

  it("prefers a stylesheet from the vault over the built-in one", async () => {
    const files = await buildSite({ ...index, themeCss: "body { color: red }" }, sources);
    expect(files.get("assets/theme.css").toString()).toBe("body { color: red }");
  });

  it("refuses to build when a source was never uploaded", async () => {
    await expect(buildSite(index, new Map())).rejects.toThrow(/not uploaded/);
  });
});
