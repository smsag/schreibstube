import { describe, expect, it } from "vitest";
import { groupSlides, slidesMarkup, type SlidePart } from "./print-slides";
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

  it("opens two columns under third-level headings, the intro above them", () => {
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

  it("opens three columns under fourth-level headings", () => {
    const [slide] = groupSlides([h(2, "S"), h(4, "A"), h(4, "B"), h(4, "C"), h(4, "D")]);
    expect(slide?.columns).toBe(3);
    expect(slide?.cells).toHaveLength(4);
  });

  it("reads the other column level as an ordinary heading inside the column", () => {
    const [slide] = groupSlides([h(2, "S"), h(3, "A"), h(4, "Unter"), b("a")]);
    expect(slide?.columns).toBe(2);
    expect(slide?.cells).toEqual([{ title: "A", body: ["==== Unter\n", "a"] }]);
  });

  it("starts the column level afresh on every slide", () => {
    const slides = groupSlides([h(2, "S"), h(3, "A"), h(2, "T"), h(4, "B")]);
    expect(slides.map((slide) => slide.columns)).toEqual([2, 3]);
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
    const markup = slidesMarkup(groupSlides([h(2, "Titel"), h(3, "A"), b("a")]));
    expect(markup).toBe(
      "#schreibstube-slide(\n" +
        '  kind: "content",\n' +
        "  level: 2,\n" +
        "  title: [\nTitel\n],\n" +
        "  columns: 2,\n" +
        "  intro: [],\n" +
        "  cells: (([\nA\n], [\na\n]),),\n" +
        ")\n"
    );
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
    expect(body).toMatch(/title: \[\nDeck\n\],[\s\S]*intro: \[\n#schreibstube-properties/);
  });

  it("is off unless asked for", () => {
    expect(markdownToTypst("## A\n\nText\n").body).toBe("== A\n\nText\n");
  });
});
