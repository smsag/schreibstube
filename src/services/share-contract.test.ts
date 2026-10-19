import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_SHARE_ASSET_BYTES,
  MAX_SHARE_ASSETS,
  MAX_SHARE_PASSWORD_LENGTH,
  MIN_SHARE_PASSWORD_LENGTH,
  parseSharedLink,
  SHARE_IMAGE_EXTENSIONS
} from "./share-link";

/**
 * The other half of the shared-link contract: the limits the plugin repeats
 * from the bridge, and the codes it accepts back, against the one table.
 */
const contract = JSON.parse(readFileSync("contracts/share-limits.json", "utf8")) as {
  passwordMinLength: number;
  passwordMaxLength: number;
  maxAssets: number;
  maxAssetBytes: number;
  imageExtensions: string[];
  codeAlphabet: string;
  codeLength: number;
  codes: { valid: string[]; invalid: string[] };
};

const linkFor = (code: string) =>
  parseSharedLink({ code, url: `https://blog.example.com/s/${code}/` });

describe("the shared-link contract, in the plugin", () => {
  it("repeats the bridge's limits", () => {
    expect(MIN_SHARE_PASSWORD_LENGTH).toBe(contract.passwordMinLength);
    expect(MAX_SHARE_PASSWORD_LENGTH).toBe(contract.passwordMaxLength);
    expect(MAX_SHARE_ASSETS).toBe(contract.maxAssets);
    expect(MAX_SHARE_ASSET_BYTES).toBe(contract.maxAssetBytes);
    expect([...SHARE_IMAGE_EXTENSIONS].sort()).toEqual(contract.imageExtensions);
  });

  it("reads back every code the bridge can draw, and only those", () => {
    for (const char of contract.codeAlphabet) {
      expect(linkFor(char.repeat(contract.codeLength))).not.toBeNull();
    }
    for (const code of contract.codes.valid) expect(linkFor(code)).not.toBeNull();
    for (const code of contract.codes.invalid) expect(linkFor(code)).toBeNull();
  });
});
