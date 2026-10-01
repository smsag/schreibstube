import { describe, expect, it } from "vitest";
import {
  articlesOf,
  cardPress,
  pictureCards,
  pictureOfRow,
  type PictureCard,
  type PictureCardSources
} from "./picture-cards";

const PICTURE = "Anhänge/harness.png";
const DESCRIPTION = "Bildbeschreibungen/harness.png – 1a2b3c4d.md";
const ARTICLE = "Artikel/How a Harness Works.md";

/**
 * A vault in a few lines: which note describes which picture, who refers to
 * whom, and when each file last changed. Pictures are the files with a
 * picture's extension, as the view decides it.
 */
function sources(
  options: {
    describes?: Record<string, string>;
    referrers?: Record<string, string[]>;
    modified?: Record<string, number>;
  } = {}
): PictureCardSources {
  const describes = options.describes ?? { [DESCRIPTION]: PICTURE };
  return {
    imageDescribedBy: (path) => describes[path] ?? null,
    isPicture: (path) => /\.(png|jpe?g|gif|webp)$/i.test(path),
    isDescriptionNote: (path) => path in describes,
    referrers: (path) => options.referrers?.[path] ?? [],
    modifiedAt: (path) => options.modified?.[path] ?? 0
  };
}

describe("pictureOfRow", () => {
  it("reads a description note as the picture it describes", () => {
    expect(pictureOfRow(DESCRIPTION, sources())).toBe(PICTURE);
  });

  it("reads a picture as itself", () => {
    expect(pictureOfRow(PICTURE, sources())).toBe(PICTURE);
  });

  it("has nothing for a note that describes no picture", () => {
    expect(pictureOfRow(ARTICLE, sources())).toBeNull();
  });
});

describe("articlesOf", () => {
  it("never counts the description note, which always refers to its picture", () => {
    const vault = sources({ referrers: { [PICTURE]: [DESCRIPTION, ARTICLE] } });
    expect(articlesOf(PICTURE, vault)).toEqual([ARTICLE]);
  });

  it("is empty for a picture no article uses", () => {
    const vault = sources({ referrers: { [PICTURE]: [DESCRIPTION] } });
    expect(articlesOf(PICTURE, vault)).toEqual([]);
  });

  it("leaves out a duplicate description and a canvas", () => {
    const vault = sources({
      describes: { [DESCRIPTION]: PICTURE, "Alt/harness – old.md": PICTURE },
      referrers: { [PICTURE]: [DESCRIPTION, "Alt/harness – old.md", "Board.canvas", ARTICLE] }
    });
    expect(articlesOf(PICTURE, vault)).toEqual([ARTICLE]);
  });

  it("puts the most recently changed article first, and settles a tie by path", () => {
    const vault = sources({
      referrers: { [PICTURE]: ["b.md", "c.md", "a.md"] },
      modified: { "a.md": 10, "b.md": 10, "c.md": 20 }
    });
    expect(articlesOf(PICTURE, vault)).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("names a note once however it was handed over", () => {
    const vault = sources({ referrers: { [PICTURE]: [ARTICLE, ARTICLE] } });
    expect(articlesOf(PICTURE, vault)).toEqual([ARTICLE]);
  });
});

describe("pictureCards", () => {
  it("makes one card per picture, in the base's order, with its articles", () => {
    const vault = sources({
      describes: { [DESCRIPTION]: PICTURE, "d2.md": "Anhänge/kurve.png" },
      referrers: { [PICTURE]: [DESCRIPTION, ARTICLE] }
    });
    expect(pictureCards(["d2.md", DESCRIPTION], vault)).toEqual({
      cards: [
        { picture: "Anhänge/kurve.png", entry: "d2.md", articles: [] },
        { picture: PICTURE, entry: DESCRIPTION, articles: [ARTICLE] }
      ],
      held: 0,
      skipped: 0
    });
  });

  it("shows a picture listed twice once, where it first appears", () => {
    const { cards } = pictureCards([PICTURE, DESCRIPTION], sources());
    expect(cards.map((card) => card.entry)).toEqual([PICTURE]);
  });

  it("counts the rows that are not pictures rather than drawing them", () => {
    expect(pictureCards([ARTICLE, "Notiz.md", DESCRIPTION], sources()).skipped).toBe(2);
  });

  it("stops at the limit and counts the pictures held back", () => {
    const describes = { "d1.md": "1.png", "d2.md": "2.png", "d3.md": "3.png" };
    const result = pictureCards(["d1.md", "d2.md", "d3.md"], sources({ describes }), 2);
    expect(result.cards.map((card) => card.picture)).toEqual(["1.png", "2.png"]);
    expect(result.held).toBe(1);
  });

  it("asks for the articles of the cards it draws only", () => {
    const asked: string[] = [];
    const vault = sources({ describes: { "d1.md": "1.png", "d2.md": "2.png" } });
    pictureCards(
      ["d1.md", "d2.md"],
      {
        ...vault,
        referrers: (path) => {
          asked.push(path);
          return [];
        }
      },
      1
    );
    expect(asked).toEqual(["1.png"]);
  });
});

describe("cardPress", () => {
  const card = (articles: string[]): PictureCard => ({
    picture: PICTURE,
    entry: DESCRIPTION,
    articles
  });

  it("opens the one article", () => {
    expect(cardPress(card([ARTICLE]))).toEqual({ kind: "article", path: ARTICLE });
  });

  it("offers a choice between several", () => {
    expect(cardPress(card(["a.md", "b.md"]))).toEqual({
      kind: "choose",
      paths: ["a.md", "b.md"]
    });
  });

  it("opens the picture when no article uses it", () => {
    expect(cardPress(card([]))).toEqual({ kind: "picture", path: PICTURE });
  });
});
