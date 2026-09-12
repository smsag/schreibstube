import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { slugify } from "./publish-index";

/**
 * The other half of the contract. The plugin derives a slug and the bridge
 * validates it, from two implementations in two languages; the table is the
 * one place that says what they both have to do.
 */
const { cases } = JSON.parse(readFileSync("contracts/slug-cases.json", "utf8")) as {
  cases: { input: string; slug: string }[];
};

describe("the shared slug contract, in the plugin", () => {
  for (const { input, slug } of cases) {
    it(`turns ${JSON.stringify(input)} into ${slug}`, () => {
      expect(slugify(input)).toBe(slug);
    });
  }
});
