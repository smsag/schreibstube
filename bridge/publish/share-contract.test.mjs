import { SHARE_WORDS } from "./share-words.mjs";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isShareCode,
  MAX_SHARE_ASSET_BYTES,
  MAX_SHARE_ASSETS,
  MAX_SHARE_PASSWORD_LENGTH,
  MIN_SHARE_PASSWORD_LENGTH,
  newShareCode,
  SHARE_IMAGE_TYPES
} from "./share.mjs";

/**
 * The plugin repeats these limits to refuse a share before it is sent, and
 * reads the codes back; the table is the one place both have to agree with.
 */
const contract = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../contracts/share-limits.json", import.meta.url)), "utf8")
);

describe("the shared-link contract, on the bridge", () => {
  it("holds the limits the plugin repeats", () => {
    expect(MIN_SHARE_PASSWORD_LENGTH).toBe(contract.passwordMinLength);
    expect(MAX_SHARE_PASSWORD_LENGTH).toBe(contract.passwordMaxLength);
    expect(MAX_SHARE_ASSETS).toBe(contract.maxAssets);
    expect(MAX_SHARE_ASSET_BYTES).toBe(contract.maxAssetBytes);
    expect([...SHARE_IMAGE_TYPES.keys()].sort()).toEqual(contract.imageExtensions);
  });

  it("draws codes the plugin reads, and reads the codes it lists", () => {
    for (const code of contract.codes.valid) expect(isShareCode(code)).toBe(true);
    for (const code of contract.codes.invalid) expect(isShareCode(code)).toBe(false);
    for (let i = 0; i < 50; i += 1) {
      expect(isShareCode(newShareCode({ open: false }))).toBe(true);
      expect(isShareCode(newShareCode({ open: true }))).toBe(true);
    }
  });

  it("draws only from words of the shape the plugin reads", () => {
    for (const word of SHARE_WORDS) expect(word).toMatch(/^[a-z]{3,8}$/);
  });
});
