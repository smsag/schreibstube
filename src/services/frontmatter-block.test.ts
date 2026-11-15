import { describe, expect, it } from "vitest";
import { frontmatterLineCount, splitFrontmatter } from "./frontmatter-block";

describe("splitFrontmatter", () => {
  it("separates the block from the body, the block keeping its fences", () => {
    expect(splitFrontmatter("---\ntitle: A\n---\n\nText\n")).toEqual({
      block: "---\ntitle: A\n---\n",
      body: "\nText\n"
    });
  });

  it("is always the exact prefix, so the two halves rebuild the text", () => {
    for (const text of [
      "---\na: 1\n---\nBody",
      "---\na: 1\n---",
      "---\r\na: 1\r\n---\r\nBody",
      "---\n---\n",
      "Body only",
      "---\nnever closed\n"
    ]) {
      const { block, body } = splitFrontmatter(text);
      expect(block + body).toBe(text);
    }
  });

  it("takes `...` as a closer, which YAML allows and a person sometimes writes", () => {
    expect(splitFrontmatter("---\na: 1\n...\nBody").body).toBe("Body");
  });

  it("tolerates trailing blanks on either fence line", () => {
    expect(splitFrontmatter("---  \na: 1\n--- \t\nBody").body).toBe("Body");
  });

  it("reads Windows line endings, leaving them in place", () => {
    expect(splitFrontmatter("---\r\na: 1\r\n---\r\nBody\r\n")).toEqual({
      block: "---\r\na: 1\r\n---\r\n",
      body: "Body\r\n"
    });
  });

  it("sees an empty block", () => {
    expect(splitFrontmatter("---\n---\nBody")).toEqual({ block: "---\n---\n", body: "Body" });
  });

  it("does not count a newline after a block that ends the text", () => {
    const text = "---\na: 1\n---";
    expect(splitFrontmatter(text)).toEqual({ block: text, body: "" });
  });

  it("treats a block that never closes as body", () => {
    const text = "---\na: 1\nBody";
    expect(splitFrontmatter(text)).toEqual({ block: "", body: text });
  });

  it("is not fooled by a rule, a longer dash run or a fence further down", () => {
    expect(splitFrontmatter("Text\n---\nMore").block).toBe("");
    expect(splitFrontmatter("----\na: 1\n---\n").block).toBe("");
    expect(splitFrontmatter("--- a\nb\n---\n").block).toBe("");
  });
});

describe("frontmatterLineCount", () => {
  it("counts both fences, and agrees with splitFrontmatter on where the body starts", () => {
    for (const text of ["---\na: 1\n---\nB", "--- \na\n...  \nB", "---\n---\nB", "---\na\n---"]) {
      const lines = text.split("\n");
      const count = frontmatterLineCount(lines);
      expect(count).toBeGreaterThan(0);
      expect(lines.slice(count).join("\n")).toBe(splitFrontmatter(text).body);
    }
    expect(frontmatterLineCount(["Text", "---"])).toBe(0);
    expect(frontmatterLineCount(["---", "a"])).toBe(0);
  });

  it("does not take whitespace beyond blanks and a carriage return after a fence", () => {
    expect(frontmatterLineCount(["---\u00a0", "a", "---"])).toBe(0);
    expect(frontmatterLineCount(["---\r", "a", "...\r"])).toBe(3);
  });
});
