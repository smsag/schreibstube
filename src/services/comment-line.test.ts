import { describe, expect, it } from "vitest";

import { isCommentLine } from "./comment-line";

describe("isCommentLine", () => {
  it("takes a line that opens with two slashes", () => {
    expect(isCommentLine("// rewrite this later")).toBe(true);
    expect(isCommentLine("//")).toBe(true);
  });

  it("takes an indented aside", () => {
    expect(isCommentLine("    // under a list item")).toBe(true);
    expect(isCommentLine("\t// tabbed")).toBe(true);
  });

  it("leaves text whose slashes come later alone", () => {
    expect(isCommentLine("see https://example.com")).toBe(false);
    expect(isCommentLine("a // b")).toBe(false);
  });

  it("needs two slashes, not one", () => {
    expect(isCommentLine("/ not an aside")).toBe(false);
    expect(isCommentLine("")).toBe(false);
  });
});
