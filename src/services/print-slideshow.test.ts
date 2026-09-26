import { describe, expect, it } from "vitest";
import {
  FILMSTRIP_PRINT_THUMBS,
  MASONRY_PRINT_COLUMNS,
  pictureEdge,
  slideshowForPrint
} from "./print-slideshow";
import type { SlideshowBlock, SlideshowLayout } from "./slideshow";

const block = (layout: SlideshowLayout, count: number): SlideshowBlock => ({
  layout,
  images: Array.from({ length: count }, (_, i) => ({ src: `b${i}.jpg`, alt: `Bild ${i}` }))
});
const sources = (plan: { images: { src: string }[] }) => plan.images.map((image) => image.src);

describe("slideshowForPrint, as the note shows it", () => {
  it("prints a stage's first picture, large, as it stands before anybody steps", () => {
    const plan = slideshowForPrint(block("slideshow", 5), "layout");
    expect(plan.arrangement).toBe("single");
    expect(plan.images).toEqual([{ src: "b0.jpg", alt: "Bild 0", width: 1 }]);
  });

  it("prints a filmstrip's first picture over every thumbnail", () => {
    const plan = slideshowForPrint(block("filmstrip", 4), "layout");
    expect(plan.arrangement).toBe("filmstrip");
    expect(sources(plan)).toEqual(["b0.jpg", "b0.jpg", "b1.jpg", "b2.jpg", "b3.jpg"]);
    expect(plan.images[0]?.width).toBe(1);
    expect(plan.images[1]?.width).toBe(1 / FILMSTRIP_PRINT_THUMBS);
    expect(plan.columns).toBe(4);
  });

  it("wraps a long filmstrip's thumbnails into rows", () => {
    expect(slideshowForPrint(block("filmstrip", 20), "layout").columns).toBe(
      FILMSTRIP_PRINT_THUMBS
    );
  });

  it("prints a feature's scene and two details, and nothing past them", () => {
    const plan = slideshowForPrint(block("feature", 6), "layout");
    expect(sources(plan)).toEqual(["b0.jpg", "b1.jpg", "b2.jpg"]);
    expect(plan.images.map((image) => image.width)).toEqual([2 / 3, 1 / 3, 1 / 3]);
  });

  it("prints a strip in the columns the screen gives it", () => {
    expect(slideshowForPrint(block("strip", 3), "layout").columns).toBe(3);
    expect(slideshowForPrint(block("strip", 4), "layout").columns).toBe(4);
    const wrapped = slideshowForPrint(block("strip", 7), "layout");
    expect(wrapped.columns).toBe(3);
    expect(wrapped.images).toHaveLength(7);
    expect(wrapped.images[0]?.width).toBe(1 / 3);
  });

  it("prints a masonry in three columns, fewer for fewer pictures", () => {
    expect(slideshowForPrint(block("masonry", 9), "layout").columns).toBe(MASONRY_PRINT_COLUMNS);
    expect(slideshowForPrint(block("masonry", 2), "layout").columns).toBe(2);
  });

  it("prints a comparison's two sides next to each other, and no third", () => {
    const plan = slideshowForPrint(block("compare", 3), "layout");
    expect(plan.arrangement).toBe("compare");
    expect(sources(plan)).toEqual(["b0.jpg", "b1.jpg"]);
    expect(plan.images.every((image) => image.width === 1 / 2)).toBe(true);
  });
});

describe("slideshowForPrint, every picture stacked", () => {
  it("prints every picture of every layout at the text's width, in order", () => {
    for (const layout of ["slideshow", "filmstrip", "feature", "compare", "strip"] as const) {
      const plan = slideshowForPrint(block(layout, 5), "stacked");
      expect(plan.arrangement, layout).toBe("stacked");
      expect(sources(plan), layout).toEqual(["b0.jpg", "b1.jpg", "b2.jpg", "b3.jpg", "b4.jpg"]);
      expect(
        plan.images.every((image) => image.width === 1),
        layout
      ).toBe(true);
    }
  });
});

describe("pictureEdge", () => {
  it("reads a picture no larger than it prints", () => {
    expect(pictureEdge(1600, 1)).toBe(1600);
    expect(pictureEdge(1600, 1 / 2)).toBe(800);
    expect(pictureEdge(1600, 2 / 3)).toBe(1067);
  });

  it("keeps a thumbnail sharp, and never exceeds the template's limit", () => {
    expect(pictureEdge(1600, 1 / 8)).toBe(400);
    expect(pictureEdge(1600, 3)).toBe(1600);
    expect(pictureEdge(1600, -1)).toBe(400);
  });
});
