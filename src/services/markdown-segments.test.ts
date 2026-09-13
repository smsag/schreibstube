import { describe, expect, it } from "vitest";
import {
  listPlaceholders,
  placeholdersIntact,
  restorePlaceholders,
  segmentMarkdown
} from "./markdown-segments";

function textsOf(markdown: string): string[] {
  return segmentMarkdown(markdown).blocks.map((b) => b.text);
}

describe("segmentMarkdown", () => {
  it("keeps a paragraph as one block", () => {
    expect(textsOf("First line\nsecond line.")).toEqual(["First line\nsecond line."]);
  });

  it("splits paragraphs on blank lines", () => {
    expect(textsOf("One.\n\nTwo.")).toEqual(["One.", "Two."]);
  });

  it("reports offsets that slice back to the block text", () => {
    const source = "Intro.\n\nBody text.";
    const blocks = segmentMarkdown(source).blocks;
    for (const block of blocks) {
      expect(source.slice(block.from, block.to)).toBe(block.text);
    }
  });

  it("isolates headings, list items, and quotes into single-line blocks", () => {
    expect(textsOf("# Title\nParagraph.")).toEqual(["# Title", "Paragraph."]);
    expect(textsOf("- one\n- two")).toEqual(["- one", "- two"]);
    expect(textsOf("> quoted\nplain")).toEqual(["> quoted", "plain"]);
  });

  it("excludes frontmatter", () => {
    expect(textsOf("---\ntitle: x\n---\n\nBody.")).toEqual(["Body."]);
  });

  it("does not treat a later horizontal rule as frontmatter", () => {
    expect(textsOf("Body.\n\n---\n\nMore.")).toEqual(["Body.", "More."]);
  });

  it("excludes fenced code blocks including their blank lines", () => {
    const source = "Before.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.";
    expect(textsOf(source)).toEqual(["Before.", "After."]);
  });

  it("excludes tables", () => {
    expect(textsOf("Intro.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nOutro.")).toEqual([
      "Intro.",
      "Outro."
    ]);
  });

  it("excludes a one-line math block without swallowing the rest of the note", () => {
    expect(textsOf("Intro.\n\n$$E = mc^2$$\n\nOutro.\n\nUnd noch einer.")).toEqual([
      "Intro.",
      "Outro.",
      "Und noch einer."
    ]);
  });

  it("excludes math blocks", () => {
    expect(textsOf("Intro.\n\n$$\nx = 1\n$$\n\nOutro.")).toEqual(["Intro.", "Outro."]);
  });

  it("drops blocks with no letters", () => {
    expect(textsOf("123 456\n\nReal text.")).toEqual(["Real text."]);
  });

  it("masks inline code, wikilinks, tags, and bare URLs", () => {
    const result = segmentMarkdown(
      "See `code` and [[Note]] at https://example.com about #thema now."
    );
    const masked = result.blocks[0]?.masked;
    expect(masked).not.toContain("`code`");
    expect(masked).not.toContain("[[Note]]");
    expect(masked).not.toContain("https://example.com");
    expect(masked).not.toContain("#thema");
    expect(masked).toContain("See ");
    expect(masked).toContain(" about ");
    expect(restorePlaceholders(masked ?? "", result.placeholders)).toBe(result.blocks[0]?.text);
  });

  it("masks a link target but keeps the label reviewable", () => {
    const result = segmentMarkdown("Read [the report](https://example.com/a_b) today.");
    const masked = result.blocks[0]?.masked;
    expect(masked).toContain("[the report](");
    expect(masked).not.toContain("example.com");
    expect(restorePlaceholders(masked ?? "", result.placeholders)).toBe(result.blocks[0]?.text);
  });

  it("gives every block distinct placeholder tokens", () => {
    const result = segmentMarkdown("`one` here.\n\n`two` there.");
    const first = listPlaceholders(result.blocks[0]?.masked ?? "");
    const second = listPlaceholders(result.blocks[1]?.masked ?? "");
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).not.toBe(second[0]);
  });
});

describe("placeholdersIntact", () => {
  it("accepts a rewrite that keeps every token", () => {
    expect(placeholdersIntact("a §P0§ b", "A §P0§ B.")).toBe(true);
  });

  it("accepts reordering", () => {
    expect(placeholdersIntact("§P0§ and §P1§", "§P1§ and §P0§")).toBe(true);
  });

  it("rejects a dropped token", () => {
    expect(placeholdersIntact("a §P0§ b", "a b")).toBe(false);
  });

  it("rejects a duplicated token", () => {
    expect(placeholdersIntact("a §P0§", "a §P0§ §P0§")).toBe(false);
  });

  it("rejects an invented token", () => {
    expect(placeholdersIntact("a §P0§", "a §P0§ §P9§")).toBe(false);
  });
});
