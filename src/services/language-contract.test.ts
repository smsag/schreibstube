import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkLanguage, MAX_LANGUAGE_CHARS } from "./publish-index";

/**
 * The language rule exists twice: here, before a site's or a note's language
 * is sent, and on the bridge, which refuses an index carrying anything else.
 * The table is shared, so neither can move alone.
 */
const table = JSON.parse(readFileSync("contracts/language-cases.json", "utf8")) as {
  maxChars: number;
  valid: { tag: string; german: boolean }[];
  invalid: string[];
};

describe("the shared language contract, in the plugin", () => {
  it("takes tags up to the same length", () => {
    expect(MAX_LANGUAGE_CHARS).toBe(table.maxChars);
  });

  for (const { tag } of table.valid) {
    it(`sends ${JSON.stringify(tag)}`, () => {
      expect(checkLanguage(tag)).toBe(tag);
    });
  }

  for (const tag of table.invalid) {
    it(`sends nothing for ${JSON.stringify(tag)}`, () => {
      expect(checkLanguage(tag)).toBeNull();
    });
  }
});
