import { describe, expect, it } from "vitest";
import { slugify } from "./path.mjs";
import { iconSvg, isIcon, splitShortcodes } from "./render/icons.mjs";
import { ICON_SHAPES } from "./render/icons.generated.mjs";
import { createRenderer, renderMarkdown } from "./render/markdown.mjs";

const md = createRenderer();
const KNOWN = new Set(["folder", "star", "a", "b"]);
const known = (name) => KNOWN.has(name);

function site(notes = []) {
  return {
    notes: new Map(notes.map((note) => [note.key, note])),
    assets: new Map(),
    slugify
  };
}

const render = (source, context = site()) => renderMarkdown(md, source, context).html;
const drawn = (html) => [...html.matchAll(/<title>([a-z0-9-]+)<\/title>/g)].map((m) => m[1]);

describe("splitShortcodes", () => {
  it("cuts a sentence into its words and its icons", () => {
    expect(splitShortcodes("Ein :folder: und :star:.", known)).toEqual([
      { text: "Ein " },
      { icon: "folder" },
      { text: " und " },
      { icon: "star" },
      { text: "." }
    ]);
  });

  it("finds icons that touch, and one that follows a name it does not know", () => {
    expect(splitShortcodes(":a::b:", known)).toEqual([{ icon: "a" }, { icon: "b" }]);
    expect(splitShortcodes(":note:folder:", known)).toEqual([
      { text: ":note" },
      { icon: "folder" }
    ]);
  });

  it("leaves what is not an icon as it was", () => {
    for (const text of [
      "10:30:45",
      "Beispiel: der Fall",
      ":note: zu Notizen",
      "https://x.de/a:b",
      ""
    ]) {
      expect(splitShortcodes(text, known).every((part) => part.text !== undefined)).toBe(true);
      expect(
        splitShortcodes(text, known)
          .map((part) => part.text)
          .join("")
      ).toBe(text);
    }
  });
});

describe(":name: on a published page", () => {
  it("draws an icon of the set inline, with its name as the title", () => {
    const html = render("Der Ordner :folder: liegt oben.\n");
    expect(html).toContain(`<p>Der Ordner ${iconSvg("folder")} liegt oben.</p>`);
    expect(iconSvg("folder")).toContain(`<title>folder</title>${ICON_SHAPES.folder}</svg>`);
  });

  it("draws our own artwork under its name too", () => {
    expect(drawn(render(":schreibstube: und :pythia:\n"))).toEqual(["schreibstube", "pythia"]);
  });

  it("draws nothing for a name the set does not have", () => {
    expect(render("Eine :notiz: ohne Symbol.\n")).toBe("<p>Eine :notiz: ohne Symbol.</p>\n");
  });

  it("leaves code, links and URLs alone", () => {
    const html = render(
      [
        "`:folder:` im Code, [ein :star: im Link](https://x.de), https://x.de/:folder:/",
        "",
        "```",
        ":folder:",
        "```",
        ""
      ].join("\n")
    );
    expect(drawn(html)).toEqual([]);
  });

  it("leaves a wikilink's words alone, published or not", () => {
    const notes = [{ key: "ziel", url: "ziel/", title: "Ziel" }];
    expect(
      drawn(render("[[Ziel|:folder: Ziel]] und [[Fehlt|:star: Fehlt]]\n", site(notes)))
    ).toEqual([]);
  });

  it("keeps a heading's id the one a link to it computes", () => {
    const html = render("## :folder: Ablage\n");
    expect(html).toContain(`<h2 id="${slugify(":folder: Ablage")}">`);
    expect(drawn(html)).toEqual(["folder"]);
  });

  it("draws icons in a list, a table and a callout, and with HTML switched off", () => {
    const source =
      "- :star: eins\n\n| a |\n| - |\n| :folder: |\n\n> [!note] :star: Titel\n> :folder:\n";
    expect(drawn(render(source))).toEqual(["star", "folder", "star", "folder"]);
    const plain = createRenderer({ allowHtml: false });
    expect(drawn(renderMarkdown(plain, ":folder:\n", site()).html)).toEqual(["folder"]);
  });

  it("draws a callout's title with its icons and escapes the rest of it", () => {
    const html = render("> [!tip]- :star: <b>Zu</b>\n> Text\n");
    expect(html).toContain(`<summary>${iconSvg("star")} &lt;b&gt;Zu&lt;/b&gt;</summary>`);
  });
});

describe("the drawings the site carries", () => {
  // The table is written by the icon build and put into pages as it is; this
  // is the check that nothing but shapes ever got into it.
  it("hold nothing but shapes with plain path data", () => {
    const shape =
      /<(path|circle|ellipse|line|polyline|polygon|rect)( [a-z0-9-]+="[0-9a-zA-Z .,-]*")*\/>/g;
    for (const [name, markup] of Object.entries(ICON_SHAPES)) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(markup.replace(shape, ""), name).toBe("");
      expect(isIcon(name)).toBe(true);
    }
  });

  it("know no name that is not their own", () => {
    expect(isIcon("constructor")).toBe(false);
    expect(isIcon("__proto__")).toBe(false);
  });
});
