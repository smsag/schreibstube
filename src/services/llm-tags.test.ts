import { describe, expect, it } from "vitest";
import {
  MAX_PROMPT_TAGS,
  parseTagsResponse,
  TAGS_MAX_INPUT_CHARS,
  tagsSystemPrompt,
  tagsUserMessage
} from "./llm-tags";

describe("tagsSystemPrompt", () => {
  it("lists the vault's tags, bounded", () => {
    const tags = Array.from({ length: MAX_PROMPT_TAGS + 10 }, (_, i) => `tag${i}`);
    const prompt = tagsSystemPrompt(tags);
    expect(prompt).toContain("tag0\ntag1");
    expect(prompt).toContain(`tag${MAX_PROMPT_TAGS - 1}`);
    expect(prompt).not.toContain(`tag${MAX_PROMPT_TAGS}\n`);
  });

  it("says so when the vault has no tags", () => {
    expect(tagsSystemPrompt([])).toContain("no tags yet");
  });
});

describe("tagsUserMessage", () => {
  it("sends the beginning of a long note", () => {
    expect(tagsUserMessage("x".repeat(TAGS_MAX_INPUT_CHARS + 5))).toHaveLength(
      TAGS_MAX_INPUT_CHARS
    );
  });
});

describe("parseTagsResponse", () => {
  it("reads the JSON object, even fenced", () => {
    expect(parseTagsResponse('```json\n{"tags": ["optik", " laser "]}\n```')).toEqual([
      "optik",
      "laser"
    ]);
  });

  it("reads a bare array", () => {
    expect(parseTagsResponse('Here: ["a", "b"]')).toEqual(["a", "b"]);
  });

  it("drops what is not a usable string and bounds the count", () => {
    const many = JSON.stringify({ tags: Array.from({ length: 30 }, (_, i) => `t${i}`) });
    expect(parseTagsResponse(many)).toHaveLength(15);
    expect(parseTagsResponse(`{"tags": [1, "", "${"x".repeat(101)}", "ok"]}`)).toEqual(["ok"]);
  });

  it("gives nothing for an unusable answer", () => {
    expect(parseTagsResponse("no tags")).toEqual([]);
    expect(parseTagsResponse('{"tags": "optik"}')).toEqual([]);
    expect(parseTagsResponse("{not json}")).toEqual([]);
    expect(parseTagsResponse(undefined as unknown as string)).toEqual([]);
  });
});
