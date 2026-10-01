import { describe, expect, it } from "vitest";
import {
  articlesOf,
  cardPress,
  opensInReadingView,
  pictureCardGroups,
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
 * picture's extension, as the view decides it; a picture's description is
 * the first note found describing it.
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
    descriptionOf: (picture) =>
      Object.keys(describes).find((note) => describes[note] === picture) ?? null,
    isPicture: (path) => /\.(png|jpe?g|gif|webp)$/i.test(path),
    isDescriptionNote: (path) => path in describes,
    referrers: (path) => options.referrers?.[path] ?? [],
    modifiedAt: (path) => options.modified?.[path] ?? 0
  };
}

/** The cards of a base without groups. */
const cardsOf = (rows: string[], vault: PictureCardSources, max?: number) =>
  pictureCardGroups([rows], vault, max);

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

  it("has nothing for a description whose link lands on something other than a picture", () => {
    const vault = sources({ describes: { "Fremd.md": "Irgendeine Notiz.md" } });
    expect(pictureOfRow("Fremd.md", vault)).toBeNull();
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

  it("leaves out a duplicate description, a canvas and an Excalidraw drawing", () => {
    const vault = sources({
      describes: { [DESCRIPTION]: PICTURE, "Alt/harness – old.md": PICTURE },
      referrers: {
        [PICTURE]: [
          DESCRIPTION,
          "Alt/harness – old.md",
          "Board.canvas",
          "Skizzen/Board.Excalidraw.md",
          ARTICLE
        ]
      },
      modified: { "Skizzen/Board.Excalidraw.md": 99 }
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

describe("pictureCardGroups", () => {
  it("makes one card per picture, in the base's order, with its articles", () => {
    const vault = sources({
      describes: { [DESCRIPTION]: PICTURE, "d2.md": "Anhänge/kurve.png" },
      referrers: { [PICTURE]: [DESCRIPTION, ARTICLE] }
    });
    expect(cardsOf(["d2.md", DESCRIPTION], vault)).toEqual({
      groups: [
        [
          { picture: "Anhänge/kurve.png", entry: "d2.md", description: "d2.md", articles: [] },
          { picture: PICTURE, entry: DESCRIPTION, description: DESCRIPTION, articles: [ARTICLE] }
        ]
      ],
      held: 0,
      skipped: 0
    });
  });

  it("keeps a starred duplicate as the card's description, since its star is there", () => {
    const vault = sources({ describes: { [DESCRIPTION]: PICTURE, "Alt/alt.md": PICTURE } });
    const [card] = cardsOf(["Alt/alt.md"], vault).groups[0] ?? [];
    expect(card).toMatchObject({ picture: PICTURE, description: "Alt/alt.md" });
  });

  it("finds the description of a picture the base listed as itself", () => {
    const [card] = cardsOf([PICTURE], sources()).groups[0] ?? [];
    expect(card?.description).toBe(DESCRIPTION);
  });

  it("has no description for a picture nobody described", () => {
    const [card] = cardsOf(["Anhänge/neu.png"], sources()).groups[0] ?? [];
    expect(card?.description).toBeNull();
  });

  it("shows a picture listed twice once, where it first appears", () => {
    const { groups } = cardsOf([PICTURE, DESCRIPTION], sources());
    expect(groups[0]?.map((card) => card.entry)).toEqual([PICTURE]);
  });

  it("shows a picture once even when its two rows fall into different groups", () => {
    const { groups } = pictureCardGroups([[DESCRIPTION], [PICTURE]], sources());
    expect(groups.map((group) => group.map((card) => card.entry))).toEqual([[DESCRIPTION], []]);
  });

  it("counts the rows that are not pictures rather than drawing them", () => {
    expect(cardsOf([ARTICLE, "Notiz.md", DESCRIPTION], sources()).skipped).toBe(2);
  });

  it("stops at the limit across groups and counts the pictures held back", () => {
    const describes = { "d1.md": "1.png", "d2.md": "2.png", "d3.md": "3.png" };
    const result = pictureCardGroups([["d1.md"], ["d2.md", "d3.md"]], sources({ describes }), 2);
    expect(result.groups.map((group) => group.map((card) => card.picture))).toEqual([
      ["1.png"],
      ["2.png"]
    ]);
    expect(result.held).toBe(1);
  });

  it("asks for the articles of the cards it draws only", () => {
    const asked: string[] = [];
    const vault = sources({ describes: { "d1.md": "1.png", "d2.md": "2.png" } });
    const counting: PictureCardSources = {
      ...vault,
      referrers: (path) => {
        asked.push(path);
        return [];
      }
    };
    cardsOf(["d1.md", "d2.md"], counting, 1);
    expect(asked).toEqual(["1.png"]);
  });
});

describe("cardPress", () => {
  const card = (articles: string[]): PictureCard => ({
    picture: PICTURE,
    entry: DESCRIPTION,
    description: DESCRIPTION,
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

describe("opensInReadingView", () => {
  it("is on for a base that never set it", () => {
    expect(opensInReadingView(undefined)).toBe(true);
    expect(opensInReadingView(null)).toBe(true);
  });

  it("follows the toggle", () => {
    expect(opensInReadingView(true)).toBe(true);
    expect(opensInReadingView(false)).toBe(false);
  });

  it("reads a false written by hand as text", () => {
    expect(opensInReadingView(" False ")).toBe(false);
  });

  it("keeps the default for anything else", () => {
    expect(opensInReadingView("nein")).toBe(true);
    expect(opensInReadingView(0)).toBe(true);
  });
});
