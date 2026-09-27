import { describe, expect, it } from "vitest";
import {
  MAX_HITS,
  clampLimit,
  isConversationSource,
  mergeHits,
  readExclude,
  readKinds
} from "./semantic-api";

describe("the API's boundary", () => {
  it("bounds a limit", () => {
    expect(clampLimit(5)).toBe(5);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10_000)).toBe(MAX_HITS);
    expect(clampLimit(2.7)).toBe(2);
    expect(clampLimit("20")).toBe(10);
    expect(clampLimit(Number.NaN)).toBe(10);
  });

  it("keeps only kinds that exist", () => {
    expect([...readKinds(["note", "video", "conversation", "note"])]).toEqual([
      "note",
      "conversation"
    ]);
    expect(readKinds("note").size).toBe(0);
  });

  it("reads excluded ids as strings only", () => {
    expect([...readExclude(["a", 1, null, "b"])]).toEqual(["a", "b"]);
    expect(readExclude(undefined).size).toBe(0);
  });

  it("recognises a source by its two functions", () => {
    expect(isConversationSource({ list: () => [], onChanged: () => () => undefined })).toBe(true);
    expect(isConversationSource({ list: [] })).toBe(false);
    expect(isConversationSource(null)).toBe(false);
  });

  it("merges kinds by score and caps", () => {
    const merged = mergeHits(
      [
        [{ kind: "note", id: "a.md", title: "a", score: 0.4 }],
        [
          { kind: "conversation", id: "c1", title: "c", score: 0.7 },
          { kind: "conversation", id: "c2", title: "d", score: 0.1 }
        ]
      ],
      2
    );
    expect(merged.map((h) => h.id)).toEqual(["c1", "a.md"]);
  });
});
