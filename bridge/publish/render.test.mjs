import { describe, expect, it } from "vitest";
import {
  codeRanges,
  createRenderer,
  renderMarkdown,
  stripComments,
  stripFrontmatter
} from "./render/markdown.mjs";
import { assetCandidates, MAX_DIMENSION, splitSize } from "./render/obsidian.mjs";
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

  it("keeps a %% inside fenced code, and the prose between two such blocks", () => {
    const source =
      '```py\nprint("%%d" % 5)\n```\n\nWichtiger Absatz.\n\n~~~sql\nWHERE x LIKE "%%"\n~~~\n';
    expect(stripComments(source)).toBe(source);
  });

  it("keeps a %% inside inline code, and still strips a comment beside it", () => {
    expect(stripComments("a `x %% y` b %% weg %% c `%%` d")).toBe("a `x %% y` b  c `%%` d");
  });

  it("reads a lone backtick as text, so a comment after it still goes", () => {
    expect(stripComments("ein ` Strich %% weg %% Ende")).toBe("ein ` Strich  Ende");
  });

  it("hides a code block that a comment in prose spans", () => {
    expect(stripComments("a %%\n```\ncode\n```\n%% b")).toBe("a  b");
  });

  it("leaves an unclosed %% as text", () => {
    expect(stripComments("hundert %% sicher")).toBe("hundert %% sicher");
  });

  it("stays linear on a note full of stray backticks", () => {
    const source = "` ``".repeat(200_000) + " %% weg %%";
    const started = Date.now();
    expect(stripComments(source).endsWith(" ")).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
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

describe("Markdown images", () => {
  const context = site({
    assets: [
      { key: "bild.png", url: "../assets/aaa-bild.png", name: "bild.png", kind: "image" },
      { key: "clip.mp4", url: "../assets/bbb-clip.mp4", name: "clip.mp4", kind: "video" },
      {
        key: "my photo.png",
        url: "../assets/ccc-my-photo.png",
        name: "my photo.png",
        kind: "image"
      },
      {
        key: "grundstück.png",
        url: "../assets/ddd-grundstueck.png",
        name: "Grundstück.png",
        kind: "image"
      },
      {
        key: "texte/bilder/haus.png",
        url: "../assets/eee-haus.png",
        name: "haus.png",
        kind: "image"
      },
      { key: "anhang/haus.png", url: "../assets/fff-haus.png", name: "haus.png", kind: "image" }
    ]
  });

  const renderIn = (source, sourcePath) => renderMarkdown(md, source, context, { sourcePath }).html;

  it("points a vault image at the file the site serves", () => {
    const html = render("![Das Haus](bild.png)", context);
    expect(html).toContain('src="../assets/aaa-bild.png"');
    expect(html).toContain('alt="Das Haus"');
    expect(html).toContain('loading="lazy"');
  });

  it("finds a name written with %20 or in angle brackets", () => {
    expect(render("![a](my%20photo.png)", context)).toContain("../assets/ccc-my-photo.png");
    expect(render("![a](<my photo.png>)", context)).toContain("../assets/ccc-my-photo.png");
  });

  it("finds a name with umlauts, which the parser percent-encodes", () => {
    expect(render("![a](Grundstück.png)", context)).toContain("../assets/ddd-grundstueck.png");
  });

  it("reads a relative path against the note's own folder", () => {
    const html = renderIn("![a](bilder/haus.png)", "Texte/Beitrag.md");
    expect(html).toContain("../assets/eee-haus.png");
    expect(renderIn("![a](../Anhang/haus.png)", "Texte/Beitrag.md")).toContain(
      "../assets/fff-haus.png"
    );
  });

  it("names the file in the alt text when the author left it empty", () => {
    expect(render("![](bild.png)", context)).toContain('alt="bild.png"');
  });

  it("plays a video rather than showing a broken image", () => {
    expect(render("![](clip.mp4)", context)).toContain(
      '<video class="embed" controls preload="metadata" src="../assets/bbb-clip.mp4">'
    );
  });

  it("degrades an image that was not published to its alt text", () => {
    const html = render("![Das fehlt](fehlt.png)", context);
    expect(html).not.toContain("<img");
    expect(html).toContain("Das fehlt");
  });

  it("leaves a remote image where it is", () => {
    expect(render("![a](https://example.com/x.png)", context)).toContain(
      'src="https://example.com/x.png"'
    );
  });

  it("escapes the alt text rather than letting it close the tag", () => {
    expect(render('![a "><script>](bild.png)', context)).not.toContain("<script>");
  });
});

describe("sizes, as Obsidian writes them", () => {
  const context = site({
    notes: [{ key: "andere", url: "../andere/", title: "Andere", slug: "andere" }],
    assets: [
      { key: "bild.png", url: "../assets/aaa-bild.png", name: "bild.png", kind: "image" },
      { key: "clip.mp4", url: "../assets/bbb-clip.mp4", name: "clip.mp4", kind: "video" }
    ]
  });

  it("reads a width, or a width and a height, after the last bar", () => {
    expect(splitSize("300")).toEqual({ label: "", width: 300 });
    expect(splitSize("300x200")).toEqual({ label: "", width: 300, height: 200 });
    expect(splitSize("Das Haus|300")).toEqual({ label: "Das Haus", width: 300 });
    expect(splitSize("Das Haus | 300 x 200")).toEqual({
      label: "Das Haus",
      width: 300,
      height: 200
    });
    expect(splitSize("a|b|300")).toEqual({ label: "a|b", width: 300 });
  });

  it("leaves text that ends in no size as alt text", () => {
    expect(splitSize("Das Haus")).toEqual({ label: "Das Haus" });
    expect(splitSize("Haus 300")).toEqual({ label: "Haus 300" });
    expect(splitSize("300px")).toEqual({ label: "300px" });
    expect(splitSize("")).toEqual({ label: "" });
  });

  it("will not set a picture to nothing, or to the size of a building", () => {
    expect(splitSize("0")).toEqual({ label: "0" });
    expect(splitSize(`${MAX_DIMENSION + 1}`)).toEqual({ label: `${MAX_DIMENSION + 1}` });
    expect(splitSize("300x0")).toEqual({ label: "300x0" });
    expect(splitSize("123456")).toEqual({ label: "123456" });
  });

  it("sizes an embed, naming the file in the alt text rather than the number", () => {
    const html = render("![[bild.png|300]]", context);
    expect(html).toContain('width="300"');
    expect(html).toContain('alt="bild.png"');
    expect(render("![[bild.png|300x200]]", context)).toContain('width="300" height="200"');
  });

  it("sizes a Markdown picture, keeping the alt text before the bar", () => {
    const html = render("![Das Haus|300](bild.png)", context);
    expect(html).toContain('src="../assets/aaa-bild.png"');
    expect(html).toContain('alt="Das Haus"');
    expect(html).toContain('width="300"');
    expect(html).not.toContain("|300");
  });

  it("sizes a picture from the web without fetching it", () => {
    const html = render("![Engelbart|100x145](https://example.com/e.jpg)", context);
    expect(html).toContain('src="https://example.com/e.jpg"');
    expect(html).toContain('alt="Engelbart" width="100" height="145"');
  });

  it("sizes a video", () => {
    expect(render("![[clip.mp4|400]]", context)).toContain(
      '<video class="embed" controls preload="metadata" src="../assets/bbb-clip.mp4" width="400">'
    );
    expect(render("![|400x300](clip.mp4)", context)).toContain('width="400" height="300"');
  });

  it("drops the size from what stands in for a missing picture or a linked note", () => {
    expect(render("![Das fehlt|300](fehlt.png)", context)).toContain("<p>Das fehlt</p>");
    expect(render("![[fehlt.png|300]]", context)).toContain("<p>fehlt.png</p>");
    expect(render("![[Andere|300]]", context)).toContain(">Andere</a>");
  });

  it("leaves an alias that is not a size as it was", () => {
    expect(render("![[bild.png|Das Haus]]", context)).toContain('alt="Das Haus"');
    expect(render("![[bild.png|Das Haus]]", context)).not.toContain("width=");
  });
});

describe("assetCandidates", () => {
  it("tries the vault path, then the note's folder, then the bare name", () => {
    expect(assetCandidates("bilder/haus.png", "Texte/Beitrag.md")).toEqual([
      "bilder/haus.png",
      "Texte/bilder/haus.png",
      "haus.png"
    ]);
  });

  it("resolves a step up, and refuses one that climbs out of the vault", () => {
    expect(assetCandidates("../Anhang/haus.png", "Texte/Beitrag.md")).toEqual([
      "Anhang/haus.png",
      "haus.png"
    ]);
  });

  it("keeps a percent that escapes nothing", () => {
    expect(assetCandidates("100%-Finanzierung.png")).toEqual(["100%-Finanzierung.png"]);
  });

  it("drops a query or a fragment", () => {
    expect(assetCandidates("bild.png#klein")).toEqual(["bild.png"]);
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

  it("points a Markdown image at the uploaded file, read from the note's folder", async () => {
    const withImage = "Ein Bild: ![Das Haus](Bilder/haus.png)\n";
    const hash = "a".repeat(64);
    const files = await buildSite(
      {
        ...index,
        notes: [{ ...index.notes[0], sha256: sha256(withImage) }],
        assets: [{ sourcePath: "Blog/Bilder/haus.png", sha256: hash, name: "haus.png" }]
      },
      new Map([[sha256(withImage), withImage]])
    );
    const page = files.get("erste/index.html").toString();
    expect(page).toMatch(/<img src="\.\.\/assets\/a+-haus\.png" alt="Das Haus" loading="lazy">/);
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

describe("codeRanges", () => {
  it("runs an unclosed fence to the end, as CommonMark reads it", () => {
    expect(codeRanges("a\n```\n%%")).toEqual([[2, 8]]);
  });

  it("closes a fence only on the same character, at least as long", () => {
    const source = "````\n```\n~~~~\n````\nx";
    expect(codeRanges(source)).toEqual([[0, source.length - 1]]);
  });

  it("pairs an inline run only with one of its own width", () => {
    expect(codeRanges("``a ` b`` c")).toEqual([[0, 9]]);
  });
});
