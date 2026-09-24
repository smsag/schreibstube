import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { imagesForLayout, parseSlideshow, stripColumns } from "./slideshow";

/**
 * The slideshow block is read here, in the vault, and again by the bridge for
 * the published site. The examples are shared, so a line the note shows and
 * the page drops — or the reverse — fails on whichever side moved.
 */
interface Case {
  name: string;
  source: string;
  expect:
    | { ok: true; layout: string; images: { src: string; alt: string }[]; shown: number }
    | { ok: false };
}

const table = JSON.parse(readFileSync("contracts/slideshow-cases.json", "utf8")) as {
  cases: Case[];
  stripColumns: [number, number][];
};

describe("the shared slideshow contract, in the plugin", () => {
  for (const { name, source, expect: wanted } of table.cases) {
    it(name, () => {
      const result = parseSlideshow(source);
      expect(result.ok).toBe(wanted.ok);
      if (!result.ok || !wanted.ok) return;
      expect(result.layout).toBe(wanted.layout);
      expect(result.images).toEqual(wanted.images);
      expect(imagesForLayout(result.layout, result.images)).toHaveLength(wanted.shown);
    });
  }

  it("sets strips in the same number of columns", () => {
    for (const [count, columns] of table.stripColumns) {
      expect(stripColumns(count)).toBe(columns);
    }
  });
});
