import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SourceCache } from "./source-cache.mjs";

/** Notes by content hash: nothing stored under a name it contradicts, bounded by size. */

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const note = (text) => [sha256(text), text];

describe("SourceCache", () => {
  it("hands back what was kept under its hash", () => {
    const cache = new SourceCache();
    const [hash, text] = note("# Erste\n");
    expect(cache.set(hash, text)).toBe(true);
    expect(cache.get(hash)).toBe(text);
  });

  it("keeps bytes as the text they encode", () => {
    const cache = new SourceCache();
    const [hash, text] = note("Grüße\n");
    cache.set(hash, Buffer.from(text, "utf8"));
    expect(cache.get(hash)).toBe("Grüße\n");
  });

  it("refuses content that does not hash to its key", () => {
    const cache = new SourceCache();
    expect(cache.set(sha256("eins"), "zwei")).toBe(false);
    expect(cache.get(sha256("eins"))).toBeUndefined();
  });

  it("drops the least recently used note when it outgrows its bound", () => {
    const cache = new SourceCache({ maxBytes: 10 });
    const [a, textA] = note("aaaa");
    const [b, textB] = note("bbbb");
    const [c, textC] = note("cccc");
    cache.set(a, textA);
    cache.set(b, textB);
    cache.get(a); // a is now the more recent of the two
    cache.set(c, textC);
    expect(cache.get(b)).toBeUndefined();
    expect(cache.get(a)).toBe(textA);
    expect(cache.get(c)).toBe(textC);
    expect(cache.bytes).toBe(8);
  });

  it("does not count a note twice when it is kept again", () => {
    const cache = new SourceCache();
    const [hash, text] = note("zweimal");
    cache.set(hash, text);
    cache.set(hash, text);
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(Buffer.byteLength(text));
  });

  it("refuses a note larger than the whole cache instead of emptying it", () => {
    const cache = new SourceCache({ maxBytes: 4 });
    const [small, textSmall] = note("klei");
    cache.set(small, textSmall);
    const [big, textBig] = note("viel zu gross");
    expect(cache.set(big, textBig)).toBe(false);
    expect(cache.get(small)).toBe(textSmall);
  });
});
