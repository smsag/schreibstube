import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assetCandidates, key } from "./render/obsidian.mjs";
import { imagesForLayout, parseSlideshow, stripColumns } from "./render/slideshow.mjs";

/**
 * The slideshow block is read by the plugin in the vault and here for the
 * site. The examples are shared, so the two readings cannot drift apart.
 */
const table = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../contracts/slideshow-cases.json", import.meta.url)),
    "utf8"
  )
);

describe("the shared slideshow contract, on the bridge", () => {
  for (const { name, source, expect: wanted } of table.cases) {
    it(name, () => {
      const result = parseSlideshow(source);
      expect(result.ok).toBe(wanted.ok);
      if (!result.ok || !wanted.ok) return;
      expect(result.layout).toBe(wanted.layout);
      expect(result.images).toEqual(wanted.images);
      expect(imagesForLayout(result.layout, result.images)).toHaveLength(wanted.shown);
      // Each path finds the file the plugin uploaded for it, the way the
      // renderer looks it up: angle brackets off, then the usual candidates.
      result.images.forEach((image, index) => {
        const src = /^<(.+)>$/.exec(image.src)?.[1] ?? image.src;
        const keys = assetCandidates(src).map(key);
        expect(keys).toContain(key(wanted.files[index]));
      });
    });
  }

  it("sets strips in the same number of columns", () => {
    for (const [count, columns] of table.stripColumns) {
      expect(stripColumns(count)).toBe(columns);
    }
  });
});
