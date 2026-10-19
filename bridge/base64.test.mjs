import { describe, expect, it } from "vitest";
import { decodedLength, isBase64 } from "./base64.mjs";

describe("base64", () => {
  it("accepts the standard alphabet in whole quads, and nothing else", () => {
    expect(isBase64("")).toBe(true);
    expect(isBase64("aGFsbG8=")).toBe(true);
    expect(isBase64("aGFsbG8")).toBe(false);
    expect(isBase64("aGFs-G8=")).toBe(false);
    expect(isBase64(42)).toBe(false);
  });

  it("measures what a text decodes to without decoding it", () => {
    for (const bytes of [0, 1, 2, 3, 4, 5, 100]) {
      const text = Buffer.alloc(bytes, 7).toString("base64");
      expect(decodedLength(text)).toBe(bytes);
    }
  });
});
