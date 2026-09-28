import { describe, expect, it } from "vitest";
import { frontmatterTagList, withAddedTags } from "./frontmatter-tags";

describe("frontmatterTagList", () => {
  it("reads a list, dropping hashes, blanks and what is not a tag", () => {
    expect(frontmatterTagList(["#a", " b ", "", null, 3, { x: 1 }])).toEqual(["a", "b", "3"]);
  });

  it("reads a string separated by commas or spaces", () => {
    expect(frontmatterTagList("a, #b  c")).toEqual(["a", "b", "c"]);
  });

  it("reads a lone number and nothing at all", () => {
    expect(frontmatterTagList(2024)).toEqual(["2024"]);
    expect(frontmatterTagList(undefined)).toEqual([]);
    expect(frontmatterTagList(null)).toEqual([]);
    expect(frontmatterTagList({ tags: "a" })).toEqual([]);
  });
});

describe("withAddedTags", () => {
  it("keeps what was there and appends what is new", () => {
    expect(withAddedTags("alt, Zwei", ["neu", "#zwei", "Neu", " "])).toEqual({
      tags: ["alt", "Zwei", "neu"],
      added: ["neu"]
    });
  });

  it("makes a list where there was none", () => {
    expect(withAddedTags(undefined, ["#a"])).toEqual({ tags: ["a"], added: ["a"] });
  });
});
