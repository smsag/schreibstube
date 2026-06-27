import { describe, expect, it } from "vitest";
import { buildHeadingIndex } from "./heading-index";

describe("buildHeadingIndex", () => {
  it("extracts markdown headings with levels and line numbers", () => {
    const content = [
      "# Top",
      "Body line",
      "## Child",
      "### Leaf",
      "Not a heading",
      "###### Deep"
    ].join("\n");

    expect(buildHeadingIndex(content)).toEqual([
      { level: 1, text: "Top", lineNumber: 0 },
      { level: 2, text: "Child", lineNumber: 2 },
      { level: 3, text: "Leaf", lineNumber: 3 },
      { level: 6, text: "Deep", lineNumber: 5 }
    ]);
  });

  it("strips inline Markdown formatting from heading text", () => {
    const content = [
      "## **Bold Title**",
      "## *Italic Title*",
      "## __Bold underscore__",
      "## `inline code`",
      "## ~~strikethrough~~",
      "## ==highlight==",
      "## [link text](https://example.com)",
      "## ![alt text](image.png)",
      "## [[wikilink]]",
      "## [[wikilink|alias]]"
    ].join("\n");

    expect(buildHeadingIndex(content)).toEqual([
      { level: 2, text: "Bold Title", lineNumber: 0 },
      { level: 2, text: "Italic Title", lineNumber: 1 },
      { level: 2, text: "Bold underscore", lineNumber: 2 },
      { level: 2, text: "inline code", lineNumber: 3 },
      { level: 2, text: "strikethrough", lineNumber: 4 },
      { level: 2, text: "highlight", lineNumber: 5 },
      { level: 2, text: "link text", lineNumber: 6 },
      { level: 2, text: "alt text", lineNumber: 7 },
      { level: 2, text: "wikilink", lineNumber: 8 },
      { level: 2, text: "alias", lineNumber: 9 }
    ]);
  });

  it("ignores empty headings and non-heading lines", () => {
    const content = [
      "# ",
      "##",
      "###  ",
      "text",
      "## Valid"
    ].join("\n");

    expect(buildHeadingIndex(content)).toEqual([
      { level: 2, text: "Valid", lineNumber: 4 }
    ]);
  });
});
