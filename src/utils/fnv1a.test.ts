import { describe, expect, it } from "vitest";
import { conversationContentHash, passageHash } from "../services/semantic/embedding-index";
import { hashText } from "../services/sync-document";
import { fnv1a } from "./fnv1a";

// Captured before the three stored hashes shared one loop: files already on
// disk carry these strings, so a change here orphans every index and record.
const INPUTS = [
  "",
  "a",
  "abc",
  "Küche hell ☀",
  "line1\nline2\r\n",
  "\u0000",
  "😀 emoji",
  "x".repeat(1000)
];

describe("the stored hashes", () => {
  it("keep their values for every input", () => {
    const numbers = [
      2166136261, 3826002220, 440920331, 4130718123, 1503189943, 84696351, 1903844278, 131170661
    ];
    const hex = [
      "811c9dc5",
      "e40c292c",
      "1a47e90b",
      "f635c1ab",
      "5998dbb7",
      "050c5d1f",
      "717a5bb6",
      "07d18165"
    ];
    expect(INPUTS.map(fnv1a)).toEqual(numbers);
    expect(INPUTS.map(passageHash)).toEqual(numbers);
    expect(INPUTS.map(hashText)).toEqual(hex);
  });

  it("keep the conversation hash unpadded and NUL-joined", () => {
    const chunks = [[], [""], ["a"], ["a", "b"], ["Küche", "hell ☀", ""], ["a\u0000b"]];
    expect(chunks.map(conversationContentHash)).toEqual([
      "811c9dc5",
      "811c9dc5",
      "e40c292c",
      "10f3abd2",
      "29b91",
      "10f3abd2"
    ]);
  });
});
