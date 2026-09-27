import { describe, expect, it } from "vitest";
import { conversationContentHash } from "./embedding-index";
import { EMBEDDING_RUNTIME } from "./embedding-models";
import { generationMark, hashPolicyFor, resolveRowHash } from "./row-provenance";

const FULL = "xenova-paraphrase-multilingual-MiniLM-L12-v2";
const LATIN = "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin";
const latin = ["Die Küche ist hell."];
const cyrillic = ["Кухня светлая."];
const plain = (chunks: string[]) => conversationContentHash(chunks);

describe("row provenance — the runtime generation", () => {
  it("leaves generation 1 unmarked, so files from before the mark read as generation 1", () => {
    expect(generationMark(1)).toBe("");
    expect(hashPolicyFor(FULL, 1).rowHash(latin)).toBe(plain(latin));
  });

  it("marks a row with the generation that embedded it", () => {
    expect(hashPolicyFor(FULL, 2).rowHash(latin)).toBe(`${plain(latin)}@g2`);
    expect(hashPolicyFor(LATIN, 2).rowHash(cyrillic)).toBe(`${plain(cyrillic)}~latinScript@g2`);
    expect(hashPolicyFor(LATIN, 2).rowHash(latin)).toBe(`${plain(latin)}@g2`);
  });

  it("reuses only rows of its own generation", () => {
    const now = hashPolicyFor(FULL, 2);
    expect(now.accepts(`${plain(latin)}@g2`, latin)).toBe(true);
    expect(now.accepts(plain(latin), latin)).toBe(false);
    expect(now.accepts(`${plain(latin)}@g3`, latin)).toBe(false);
    // An older device must not take a newer row either.
    expect(hashPolicyFor(FULL, 1).accepts(`${plain(latin)}@g2`, latin)).toBe(false);
  });

  it("keeps the variant rule within a generation and refuses it across one", () => {
    const variant = hashPolicyFor(LATIN, 2);
    expect(variant.accepts(`${plain(cyrillic)}~latinScript@g2`, cyrillic)).toBe(true);
    expect(variant.accepts(`${plain(cyrillic)}@g2`, cyrillic)).toBe(true);
    expect(variant.accepts(`${plain(cyrillic)}~latinScript`, cyrillic)).toBe(false);
    expect(hashPolicyFor(FULL, 2).accepts(`${plain(cyrillic)}~latinScript@g2`, cyrillic)).toBe(
      false
    );
  });

  it("re-embeds a row from the previous runtime under the current mark", () => {
    const policy = hashPolicyFor(FULL);
    const decided = resolveRowHash(policy, plain(latin), latin);
    expect(decided.reuse).toBe(false);
    expect(decided.hash).toBe(plain(latin) + generationMark(EMBEDDING_RUNTIME.generation));
    expect(resolveRowHash(policy, decided.hash, latin)).toEqual({
      hash: decided.hash,
      reuse: true
    });
  });

  it("still re-embeds a row whose text changed", () => {
    const policy = hashPolicyFor(FULL, 2);
    expect(policy.accepts(`${plain(["alt"])}@g2`, latin)).toBe(false);
  });
});
