import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_MARK,
  groupSlides,
  markSlideDirectives,
  parseWidths,
  MAX_FIT_REPORT_CHARS,
  readSlideFits,
  slidesMarkup,
  smallSlides,
  type SlidePart
} from "./print-slides";
import { markdownToTypst } from "./markdown-typst";

const h = (level: number, markup: string): SlidePart => ({ kind: "heading", level, markup });
const b = (markup: string): SlidePart => ({ kind: "block", markup });
const rule: SlidePart = { kind: "break" };

describe("groupSlides", () => {
  it("starts a slide at every first- and second-level heading, titled by it", () => {
    const slides = groupSlides([h(2, "Eins"), b("a"), h(1, "Zwei"), b("b"), h(2, "Drei")]);
    expect(slides.map((slide) => [slide.title, slide.level, slide.intro])).toEqual([
      ["Eins", 2, ["a"]],
      ["Zwei", 1, ["b"]],
      ["Drei", 2, []]
    ]);
    expect(slides.every((slide) => slide.kind === "content")).toBe(true);
  });

  it("makes an empty first-level heading a divider, and the title slide when it opens the deck", () => {
    const slides = groupSlides([h(1, "Deck"), h(1, "Teil"), h(2, "Folie"), b("x"), h(1, "Ende")]);
    expect(slides.map((slide) => slide.kind)).toEqual(["title", "section", "content", "section"]);
  });

  it("keeps an empty second-level heading as a slide with only its title", () => {
    expect(groupSlides([h(2, "Nur Titel")])[0]).toMatchObject({ kind: "content", intro: [] });
  });

  it("puts what comes before any heading on an untitled slide", () => {
    expect(groupSlides([b("vorab"), h(2, "Eins")])[0]).toMatchObject({
      title: null,
      level: 0,
      intro: ["vorab"]
    });
  });

  it("opens two columns under two third-level headings, the intro above them", () => {
    const [slide] = groupSlides([h(2, "S"), b("intro"), h(3, "A"), b("a"), h(3, "B"), b("b")]);
    expect(slide).toMatchObject({
      columns: 2,
      intro: ["intro"],
      cells: [
        { title: "A", body: ["a"] },
        { title: "B", body: ["b"] }
      ]
    });
  });

  it("has as many columns as third-level headings: one, two or three", () => {
    const count = (n: number) =>
      groupSlides([h(2, "S"), ...Array.from({ length: n }, (_, i) => h(3, `C${i}`))])[0]?.columns;
    expect([count(0), count(1), count(2), count(3)]).toEqual([1, 1, 2, 3]);
  });

  it("starts a second row at the fourth column rather than narrowing the first", () => {
    const [slide] = groupSlides([h(2, "S"), h(3, "A"), h(3, "B"), h(3, "C"), h(3, "D")]);
    expect(slide?.columns).toBe(3);
    expect(slide?.cells).toHaveLength(4);
  });

  it("reads a fourth-level heading as an ordinary heading inside its column", () => {
    const [slide] = groupSlides([h(2, "S"), h(3, "A"), h(4, "Unter"), b("a"), h(3, "B")]);
    expect(slide?.columns).toBe(2);
    expect(slide?.cells[0]).toEqual({ title: "A", body: ["==== Unter\n", "a"] });
  });

  it("counts the columns afresh on every slide", () => {
    const slides = groupSlides([h(2, "S"), h(3, "A"), h(3, "B"), h(2, "T"), h(3, "C")]);
    expect(slides.map((slide) => slide.columns)).toEqual([2, 1]);
  });

  it("keeps fifth- and sixth-level headings as headings", () => {
    const [slide] = groupSlides([h(2, "S"), h(5, "Klein")]);
    expect(slide?.intro).toEqual(["===== Klein\n"]);
  });

  it("starts an untitled slide at a rule, and drops one left empty", () => {
    const slides = groupSlides([h(2, "S"), b("a"), rule, b("weiter"), rule, rule, h(2, "T")]);
    expect(slides.map((slide) => [slide.title, slide.intro])).toEqual([
      ["S", ["a"]],
      [null, ["weiter"]],
      ["T", []]
    ]);
  });

  it("makes nothing of nothing", () => {
    expect(groupSlides([])).toEqual([]);
    expect(groupSlides([rule])).toEqual([]);
  });
});

describe("slidesMarkup", () => {
  it("calls the slide helper once per slide, every piece as content", () => {
    const markup = slidesMarkup(groupSlides([h(2, "Titel"), h(3, "A"), b("a"), h(3, "B")]));
    expect(markup).toBe(
      "#schreibstube-slide(\n" +
        '  kind: "content",\n' +
        "  level: 2,\n" +
        "  horizontal: center,\n" +
        "  title: [\nTitel\n],\n" +
        "  columns: 2,\n" +
        "  widths: none,\n" +
        '  layout: "text",\n' +
        "  picture: none,\n" +
        "  notes: none,\n" +
        "  intro: [],\n" +
        "  cells: (([\nA\n], [\n#schreibstube-slide-block[\na\n]\n]), ([\nB\n], []),),\n" +
        ")\n"
    );
  });

  it("hands every block to the slide-block helper, one call each", () => {
    const markup = slidesMarkup(groupSlides([h(2, "T"), b("eins\n"), b("- zwei\n")]));
    expect(markup).toContain(
      "  intro: [\n#schreibstube-slide-block[\neins\n]\n#schreibstube-slide-block[\n- zwei\n]\n],\n"
    );
  });

  it("passes the alignment to every slide", () => {
    const markup = slidesMarkup(groupSlides([h(2, "A"), h(2, "B")]), "left");
    expect(markup.match(/ {2}horizontal: left,\n/g)).toHaveLength(2);
  });

  it("gives an untitled slide no title", () => {
    expect(slidesMarkup(groupSlides([b("x")]))).toContain("  title: none,\n");
  });
});

describe("the converter's deck", () => {
  const deck = (source: string, options = {}) =>
    markdownToTypst(source, { slides: true, ...options }).body;

  it("groups a note by its headings", () => {
    const body = deck("# Deck\n\n## Eins\n\nText\n\n### Links\n\nL\n\n### Rechts\n\nR\n");
    expect(body.match(/#schreibstube-slide\(/g)).toHaveLength(2);
    expect(body).toContain('kind: "title"');
    expect(body).toContain("columns: 2");
    expect(body).not.toMatch(/^=+ /m);
  });

  it("reads a setext heading as a slide's heading too", () => {
    expect(deck("Eins\n----\n\nText\n")).toContain("title: [\nEins\n]");
  });

  it("starts a slide at a rule rather than a page, whatever the template's habit", () => {
    const body = deck("## A\n\nx\n\n---\n\ny\n", { hrIsPageBreak: true });
    expect(body).not.toContain("pagebreak");
    expect(body.match(/#schreibstube-slide\(/g)).toHaveLength(2);
  });

  it("leaves a heading inside a callout to the callout", () => {
    const body = deck("## A\n\n> [!note] Hinweis\n> ## Innen\n> Text\n");
    expect(body.match(/#schreibstube-slide\(/g)).toHaveLength(1);
    expect(body).toContain("== Innen");
  });

  it("leaves a rule inside a list item to the list", () => {
    const body = deck("## A\n\n- eins\n\n  ---\n- zwei\n");
    expect(body.match(/#schreibstube-slide\(/g)).toHaveLength(1);
  });

  it("puts the properties on the first slide, under its title", () => {
    const body = deck("# Deck\n\nText\n", { properties: [["Ort", "Berlin"]] });
    expect(body).toMatch(
      /title: \[\nDeck\n\],[\s\S]*intro: \[\n#schreibstube-slide-block\[\n#schreibstube-properties/
    );
  });

  it("prints a picture with its alt text as the caption, in a callout too", () => {
    const image = () => "assets/a.png";
    const body = deck("## A\n\n![Die Küche](a.png)\n\n> [!note] N\n> ![Innen](a.png)\n", { image });
    expect(body).toContain('#schreibstube-slide-image("assets/a.png", "Die Küche")');
    expect(body).toContain('#schreibstube-slide-image("assets/a.png", "Innen")');
    expect(body).not.toContain("#schreibstube-image(");
  });

  it("reads a width written as an embed's alias as no caption", () => {
    const body = deck("## A\n\n![[a.png|300]]\n\n![[a.png|640x480]]\n", { image: () => "a.png" });
    expect(body.match(/#schreibstube-slide-image\("a.png", ""\)/g)).toHaveLength(2);
  });

  it("sends the alignment it is given to the slides", () => {
    expect(deck("## A\n", { slideAlign: "left" })).toContain("horizontal: left,");
  });

  it("is off unless asked for", () => {
    expect(markdownToTypst("## A\n\nText\n").body).toBe("== A\n\nText\n");
    const plain = markdownToTypst("![B](b.png)\n", { image: () => "b.png" }).body;
    expect(plain).toContain('#schreibstube-image("b.png", "B")');
  });
});

describe("readSlideFits", () => {
  it("reads the pages and shares the compile reported", () => {
    const report = JSON.stringify([
      { page: 3, scale: 0.5 },
      { page: 7, scale: 0.92 }
    ]);
    expect(readSlideFits(report)).toEqual([
      { page: 3, scale: 0.5 },
      { page: 7, scale: 0.92 }
    ]);
  });

  it("drops every entry that is not a page and a share between nought and one", () => {
    const report = JSON.stringify([
      { page: 0, scale: 0.5 },
      { page: 2.5, scale: 0.5 },
      { page: 4, scale: 1.5 },
      { page: 5, scale: 0 },
      { page: "6", scale: 0.5 },
      null,
      { page: 8, scale: 0.7 }
    ]);
    expect(readSlideFits(report)).toEqual([{ page: 8, scale: 0.7 }]);
  });

  it("reads anything that is not a JSON list, or too long to read, as no report", () => {
    expect(readSlideFits(undefined)).toEqual([]);
    expect(readSlideFits("not json")).toEqual([]);
    expect(readSlideFits('{"page": 1}')).toEqual([]);
    expect(readSlideFits(" ".repeat(MAX_FIT_REPORT_CHARS + 1))).toEqual([]);
  });
});

describe("smallSlides", () => {
  it("names the slides set below the threshold, each once at its smallest", () => {
    const fits = [
      { page: 9, scale: 0.4 },
      { page: 2, scale: 0.55 },
      { page: 9, scale: 0.3 },
      { page: 5, scale: 0.8 }
    ];
    expect(smallSlides(fits)).toEqual({ pages: [2, 9], smallest: 0.3 });
  });

  it("says nothing when every slide stays readable", () => {
    expect(smallSlides([{ page: 1, scale: 0.75 }])).toBeNull();
    expect(smallSlides([])).toBeNull();
  });
});

describe("column widths", () => {
  const deck = (source: string) => markdownToTypst(source, { slides: true });

  it("reads two or three shares, however they are separated", () => {
    expect(parseWidths("1 2")).toEqual([1, 2]);
    expect(parseWidths("1:2")).toEqual([1, 2]);
    expect(parseWidths(" 1, 1, 2 ")).toEqual([1, 1, 2]);
    expect(parseWidths("1.5 1")).toEqual([1.5, 1]);
  });

  it("reads nothing else", () => {
    for (const value of ["", "2", "1 1 1 1", "1 zwei", "0 1", "1 13", "-1 2", "1/3 2/3"]) {
      expect(parseWidths(value)).toBeNull();
    }
  });

  it("lifts a setting out of its comment onto a line of its own", () => {
    expect(markSlideDirectives("## A <!-- columns: 1 2 -->")).toBe(
      `## A\n\n${DIRECTIVE_MARK}columns 1 2\n`
    );
    expect(markSlideDirectives("%% columns: 1 2 %%")).toBe(`\n\n${DIRECTIVE_MARK}columns 1 2\n`);
  });

  it("leaves code, other comments and unknown settings as they are", () => {
    const source = "```md\n<!-- columns: 1 2 -->\n```\n<!-- note to self -->\n<!-- colour: red -->";
    expect(markSlideDirectives(source)).toBe(source);
  });

  it("gives the columns their shares, from the heading's line or a line in the slide", () => {
    const beside = deck("## A <!-- columns: 1 2 -->\n\n### L\n\nl\n\n### R\n\nr\n").body;
    expect(beside).toContain("widths: (1fr, 2fr, ),");
    const below = deck("## A\n\n%% columns: 2 1 1 %%\n\n### L\n\n### M\n\n### R\n").body;
    expect(below).toContain("widths: (2fr, 1fr, 1fr, ),");
  });

  it("takes a setting written above a slide's heading for that slide", () => {
    const body = deck("<!-- columns: 1 3 -->\n## A\n\n### L\n\n### R\n").body;
    expect(body.match(/#schreibstube-slide\(/g)).toHaveLength(1);
    expect(body).toContain("widths: (1fr, 3fr, ),");
  });

  it("keeps columns equal and says why when the shares do not match the columns", () => {
    const { body, warnings } = deck("## Zwei *Wege* <!-- columns: 1 2 3 -->\n\n### L\n\n### R\n");
    expect(body).toContain("widths: none,");
    expect(warnings).toEqual([
      'the slide "Zwei *Wege*": 3 column widths for 2 columns, so its columns stay equal'
    ]);
    expect(deck("## B <!-- columns: eins zwei -->\n\n### L\n\n### R\n").warnings[0]).toContain(
      "could not be read"
    );
  });

  it("strips the comment as ever when the note is not a deck", () => {
    expect(markdownToTypst("## A <!-- columns: 1 2 -->\n").body).toBe("== A\n");
  });

  it("never prints a setting's line as text", () => {
    const body = deck("## A\n\nText <!-- columns: 1 2 --> weiter\n").body;
    expect(body).not.toContain("columns 1 2");
    expect(body).not.toContain("\u0001");
  });
});

describe("picture layouts", () => {
  const picture = (alt = "") => b(`#schreibstube-slide-image("a.png", "${alt}")\n`);
  const layout = (value: string): SlidePart => ({ kind: "directive", name: "layout", value });

  it("gives a slide of one picture and nothing else all the room", () => {
    const [slide] = groupSlides([h(2, "S"), picture("Küche")]);
    expect(slide).toMatchObject({ layout: "picture", intro: [] });
    expect(slide?.picture).toContain('"Küche"');
  });

  it("keeps a picture with anything beside it, or two pictures, an ordinary slide", () => {
    expect(groupSlides([h(2, "S"), picture(), b("Text\n")])[0]?.layout).toBe("text");
    expect(
      groupSlides([
        h(2, "S"),
        b('#schreibstube-slide-image("a.png", "")\n#schreibstube-slide-image("b.png", "")\n')
      ])[0]?.layout
    ).toBe("text");
    expect(groupSlides([h(2, "S"), h(3, "A"), picture()])[0]?.layout).toBe("text");
  });

  it("sets the first picture apart for image-left and image-right", () => {
    const [left] = groupSlides([
      h(2, "S"),
      layout("image-left"),
      b("Text\n"),
      picture("A"),
      picture("B")
    ]);
    expect(left).toMatchObject({
      layout: "image-left",
      intro: ["Text\n", expect.stringContaining('"B"')]
    });
    expect(left?.picture).toContain('"A"');
    expect(groupSlides([h(2, "S"), layout(" Image-Right "), picture()])[0]?.layout).toBe(
      "image-right"
    );
  });

  it("names a layout it does not know, and one asked for without a picture", () => {
    expect(groupSlides([h(2, "S"), layout("links"), picture()])[0]).toMatchObject({
      layout: "picture",
      problems: [{ kind: "layout", value: "links" }]
    });
    expect(groupSlides([h(2, "S"), layout("image-left"), b("Text\n")])[0]).toMatchObject({
      layout: "text",
      problems: [{ kind: "no-picture", layout: "image-left" }]
    });
  });

  it("leaves a title slide and a divider alone", () => {
    expect(groupSlides([h(1, "Deck"), layout("image-left")])[0]).toMatchObject({
      kind: "title",
      problems: []
    });
  });
});

describe("speaker notes", () => {
  const notes = (markup: string): SlidePart => ({ kind: "notes", markup });

  it("gives a slide its notes, never its body", () => {
    const [slide] = groupSlides([h(2, "S"), b("Text\n"), notes("Sag das.\n")]);
    expect(slide).toMatchObject({ intro: ["Text\n"], notes: ["Sag das.\n"] });
  });

  it("gives notes written above a heading to that slide", () => {
    expect(groupSlides([notes("Vorab.\n"), h(2, "S")])[0]?.notes).toEqual(["Vorab.\n"]);
  });

  it("takes a notes callout off the slide, and leaves it a callout elsewhere", () => {
    const source = "## A\n\nText\n\n> [!notes]\n> Nur für mich.\n";
    const deck = markdownToTypst(source, { slides: true }).body;
    expect(deck).toContain("notes: [\nNur für mich.\n]");
    expect(deck).not.toContain("schreibstube-callout");
    expect(markdownToTypst(source).body).toContain("#schreibstube-callout");
  });

  it("adds the notes pages only when asked and only when there are notes", () => {
    const source = "## A\n\n> [!notes]\n> Hallo\n";
    expect(markdownToTypst(source, { slides: true }).body).not.toContain(
      "schreibstube-slide-notes"
    );
    expect(markdownToTypst(source, { slides: true, speakerNotes: true }).body).toContain(
      '#schreibstube-slide-notes(heading: "Speaker notes", slide: "Slide")'
    );
    expect(markdownToTypst("## A\n", { slides: true, speakerNotes: true }).body).not.toContain(
      "schreibstube-slide-notes"
    );
  });
});

describe("agenda", () => {
  const agenda: SlidePart = { kind: "directive", name: "agenda", value: "" };

  it("lists the deck's section dividers", () => {
    const slides = groupSlides([
      h(1, "Deck"),
      h(2, "Agenda"),
      agenda,
      h(1, "Eins"),
      h(2, "x"),
      h(1, "Zwei")
    ]);
    expect(slides[1]?.intro).toEqual(["- Eins\n- Zwei\n"]);
    expect(slides.map((slide) => slide.kind)).toEqual([
      "title",
      "content",
      "section",
      "content",
      "section"
    ]);
  });

  it("lists every other titled slide when the deck has no dividers", () => {
    const slides = groupSlides([h(2, "Agenda"), agenda, h(2, "Eins"), h(2, "Zwei")]);
    expect(slides[0]?.intro).toEqual(["- Eins\n- Zwei\n"]);
  });

  it("reads the bare comment", () => {
    expect(markSlideDirectives("## Agenda <!-- agenda -->")).toBe(
      `## Agenda\n\n${DIRECTIVE_MARK}agenda\n`
    );
  });
});

describe("a drawing on a slide", () => {
  it("is a slide picture captioned with the drawing's own name, not the heading", () => {
    const body = markdownToTypst("## Stufen\n\n```mermaid\ngraph LR; A-->B\n```\n", {
      slides: true,
      diagramImage: () => ["assets/d.png"],
      diagramTitle: () => "Pipeline"
    }).body;
    expect(body).toContain('layout: "picture"');
    expect(body).toContain('#schreibstube-slide-image("assets/d.png", "Pipeline")');
  });
});
