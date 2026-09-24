import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { de } from "../i18n/de";
import { referencedAttachments } from "./publish-index";
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
    | {
        ok: true;
        layout: string;
        images: { src: string; alt: string }[];
        shown: number;
        files: string[];
      }
    | { ok: false };
}

interface Labels {
  region: Record<string, string>;
  previous: string;
  next: string;
  fullscreen: string;
  exit: string;
  compareHandle: string;
  showImage: string;
}

const table = JSON.parse(readFileSync("contracts/slideshow-cases.json", "utf8")) as {
  cases: Case[];
  stripColumns: [number, number][];
  labels: Labels;
};

const count = (template: string, n: number) => template.replace("{n}", String(n));

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

  // The block is read a third time, to collect what the publish uploads. A
  // picture the vault shows and the upload misses is missing on the site.
  for (const { name, source, expect: wanted } of table.cases) {
    if (!wanted.ok) continue;
    it(`uploads what it shows: ${name}`, () => {
      const note = "Text\n\n```schreibstube-slideshow\n" + source + "\n```\n";
      const uploads = referencedAttachments(note);
      for (const file of wanted.files) expect(uploads).toContain(file);
    });
  }

  it("speaks the site's German: the plugin's strings are the shared ones", () => {
    const { labels } = table;
    const words = de.slideshow;
    expect(words.region(3)).toBe(count(labels.region.slideshow!, 3));
    expect(words.regionFilmstrip(3)).toBe(count(labels.region.filmstrip!, 3));
    expect(words.regionFeature(3)).toBe(count(labels.region.feature!, 3));
    expect(words.regionStrip(3)).toBe(count(labels.region.strip!, 3));
    expect(words.regionMasonry(3)).toBe(count(labels.region.masonry!, 3));
    expect(words.regionCompare).toBe(labels.region.compare);
    expect(words.previous).toBe(labels.previous);
    expect(words.next).toBe(labels.next);
    expect(words.fullscreen).toBe(labels.fullscreen);
    expect(words.exit).toBe(labels.exit);
    expect(words.compareHandle).toBe(labels.compareHandle);
    expect(words.showImage(2)).toBe(count(labels.showImage, 2));
  });

  it("sets strips in the same number of columns", () => {
    for (const [count, columns] of table.stripColumns) {
      expect(stripColumns(count)).toBe(columns);
    }
  });
});
