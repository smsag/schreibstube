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
