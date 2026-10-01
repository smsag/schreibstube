import { describe, expect, it } from "vitest";
import {
  articleLink,
  articleLinks,
  articlesOf,
  carriedArticleLinks,
  MAX_ARTICLE_LINKS,
  sameArticleLinks,
  type ArticleSources
} from "./picture-articles";

const PICTURE = "Anhänge/harness.png";
const DESCRIPTION = "Bildbeschreibungen/harness.png – 1a2b3c4d.md";
const ARTICLE = "Artikel/How a Harness Works.md";

/** Who refers to the picture, and which of them are descriptions. */
function sources(referrers: string[], descriptions: string[] = [DESCRIPTION]): ArticleSources {
  return {
    referrers: (path) => (path === PICTURE ? referrers : []),
    isDescriptionNote: (path) => descriptions.includes(path)
  };
}

describe("articlesOf", () => {
  it("never counts the description note, which always refers to its picture", () => {
    expect(articlesOf(PICTURE, sources([DESCRIPTION, ARTICLE]))).toEqual([ARTICLE]);
  });

  it("is empty for a picture no article uses", () => {
    expect(articlesOf(PICTURE, sources([DESCRIPTION]))).toEqual([]);
  });

  it("leaves out a duplicate description, a canvas and an Excalidraw drawing", () => {
    const vault = sources(
      [DESCRIPTION, "Alt/harness – alt.md", "Board.canvas", "Skizzen/Board.Excalidraw.md", ARTICLE],
      [DESCRIPTION, "Alt/harness – alt.md"]
    );
    expect(articlesOf(PICTURE, vault)).toEqual([ARTICLE]);
  });

  it("leaves out a note whose path would break the link", () => {
    expect(articlesOf(PICTURE, sources(["Notizen/Teil #2.md", "Notizen/[Entwurf].md"]))).toEqual(
      []
    );
  });

  it("sorts by path, so an edit to an article never reorders the list", () => {
    expect(articlesOf(PICTURE, sources(["c.md", "a.md", "b.md"]))).toEqual([
      "a.md",
      "b.md",
      "c.md"
    ]);
  });

  it("names a note once however it was handed over", () => {
    expect(articlesOf(PICTURE, sources([ARTICLE, ARTICLE]))).toEqual([ARTICLE]);
  });

  it("stops at the bound", () => {
    const many = Array.from({ length: MAX_ARTICLE_LINKS + 5 }, (_, i) => `n${1000 + i}.md`);
    const articles = articlesOf(PICTURE, sources(many));
    expect(articles).toHaveLength(MAX_ARTICLE_LINKS);
    expect(articles[0]).toBe("n1000.md");
  });
});

describe("articleLink", () => {
  it("links a note by its path without the extension", () => {
    expect(articleLink(ARTICLE)).toBe("[[Artikel/How a Harness Works]]");
    expect(articleLinks(["a.md", "Ordner/B.MD"])).toEqual(["[[a]]", "[[Ordner/B]]"]);
  });
});

describe("sameArticleLinks", () => {
  const wanted = ["[[a]]", "[[b]]"];

  it("is the same only for the same links in the same order", () => {
    expect(sameArticleLinks(["[[a]]", "[[b]]"], wanted)).toBe(true);
    expect(sameArticleLinks(["[[b]]", "[[a]]"], wanted)).toBe(false);
    expect(sameArticleLinks(["[[a]]"], wanted)).toBe(false);
  });

  it("takes a missing or misshapen value as a difference", () => {
    expect(sameArticleLinks(undefined, [])).toBe(false);
    expect(sameArticleLinks("[[a]]", ["[[a]]"])).toBe(false);
    expect(sameArticleLinks([["[[a]]"]], ["[[a]]"])).toBe(false);
  });

  it("takes an empty list as saying no article", () => {
    expect(sameArticleLinks([], [])).toBe(true);
  });
});

describe("carriedArticleLinks", () => {
  it("keeps the well-formed links of a list", () => {
    expect(carriedArticleLinks(["[[a]]", "a", 3, "[[b|alias]]", "[[c]]"])).toEqual([
      "[[a]]",
      "[[c]]"
    ]);
  });

  it("carries nothing that is not a list", () => {
    expect(carriedArticleLinks("[[a]]")).toBeUndefined();
    expect(carriedArticleLinks(undefined)).toBeUndefined();
  });

  it("carries at most the bound", () => {
    const many = Array.from({ length: MAX_ARTICLE_LINKS + 3 }, (_, i) => `[[n${i}]]`);
    expect(carriedArticleLinks(many)).toHaveLength(MAX_ARTICLE_LINKS);
  });
});
