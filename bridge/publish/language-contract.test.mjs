import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isGerman, isLanguageTag, MAX_LANGUAGE_CHARS } from "./render/language.mjs";

/**
 * The language rule exists twice: here, and in the plugin that checks a
 * site's or a note's language before it sends one. A tag the plugin sends and
 * the bridge refuses fails the whole index, so the table is shared.
 */
const table = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../contracts/language-cases.json", import.meta.url)),
    "utf8"
  )
);

describe("the shared language contract, on the bridge", () => {
  it("takes tags up to the same length", () => {
    expect(MAX_LANGUAGE_CHARS).toBe(table.maxChars);
  });

  for (const { tag, german } of table.valid) {
    it(`takes ${JSON.stringify(tag)}, in ${german ? "German" : "English"}`, () => {
      expect(isLanguageTag(tag)).toBe(true);
      expect(isGerman(tag)).toBe(german);
    });
  }

  for (const tag of table.invalid) {
    it(`refuses ${JSON.stringify(tag)}`, () => {
      expect(isLanguageTag(tag)).toBe(false);
    });
  }
});
