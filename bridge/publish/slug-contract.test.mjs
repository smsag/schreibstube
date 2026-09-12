import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isValidSlug, slugify } from "./path.mjs";

/**
 * The slug rule exists twice: here, and in the plugin that derives the slug
 * before the bridge ever sees it. They have to agree — a disagreement publishes
 * a page at an address nothing links to, and nothing else would notice.
 *
 * The table is shared rather than duplicated, and both suites read it.
 */
const { cases } = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../contracts/slug-cases.json", import.meta.url)), "utf8")
);

describe("the shared slug contract, on the bridge", () => {
  for (const { input, slug } of cases) {
    it(`turns ${JSON.stringify(input)} into ${slug}`, () => {
      expect(slugify(input)).toBe(slug);
    });
  }

  it("produces only slugs the path rules accept", () => {
    for (const { slug } of cases) {
      expect(isValidSlug(slug)).toBe(true);
    }
  });
});
