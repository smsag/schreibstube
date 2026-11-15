import { describe, expect, it } from "vitest";
import { sha256 } from "./sha256";

describe("sha256", () => {
  it("writes the digest as lowercase hex, two digits a byte", async () => {
    expect(await sha256(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashes a view's own bytes, not the buffer behind it", async () => {
    const window = new TextEncoder().encode("xabcx").subarray(1, 4);
    expect(await sha256(window)).toBe(await sha256(new TextEncoder().encode("abc")));
  });
});
