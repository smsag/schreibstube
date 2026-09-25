/**
 * A slideshow on paper.
 *
 * On screen a slideshow is something to step through, swipe or drag; paper
 * holds still. Two ways to print one, chosen in the print dialog for every
 * slideshow of the note at once:
 *
 * - `layout`, the default: the block as it stands on screen before anybody
 *   touches it. A stage shows its first picture; a filmstrip its first picture
 *   over the row of thumbnails; a feature its scene and two details; a strip,
 *   a masonry and a comparison all their pictures, arranged as on screen.
 * - `stacked`: every picture of the block, one under the other at the width of
 *   the text, each with its description — the series as a series.
 *
 * What this decides is which pictures appear, in which arrangement, and how
 * wide each is on the page, so that a picture is read no larger than it will
 * be printed. How an arrangement is drawn is the prelude's
 * `schreibstube-slideshow`, which a template may replace.
 */
import {
  imagesForLayout,
  stripColumns,
  type SlideshowBlock,
  type SlideshowImage
} from "./slideshow";

export type SlideshowPrintMode = "layout" | "stacked";

export const SLIDESHOW_PRINT_MODES: readonly SlideshowPrintMode[] = ["layout", "stacked"];

/** How the prelude draws the pictures it is given. */
export type SlideshowArrangement =
  "single" | "filmstrip" | "feature" | "strip" | "masonry" | "compare" | "stacked";

/** Masonry's columns: 180 px each on screen, which is three across a note. */
export const MASONRY_PRINT_COLUMNS = 3;

/** A filmstrip's thumbnails per row on paper, where the screen scrolls them. */
export const FILMSTRIP_PRINT_THUMBS = 8;

export interface PrintedImage extends SlideshowImage {
  /** The share of the text width the picture takes on the page, 0–1. */
  width: number;
}

export interface SlideshowPrint {
  arrangement: SlideshowArrangement;
  /** For a filmstrip, the first picture again as the stage, then the thumbnails. */
  images: PrintedImage[];
  columns: number;
}

/** Which pictures of a block reach the page, where, and how wide. */
export function slideshowForPrint(block: SlideshowBlock, mode: SlideshowPrintMode): SlideshowPrint {
  const all = block.images;
  const at =
    (width: number) =>
    (image: SlideshowImage): PrintedImage => ({ ...image, width });

  if (mode === "stacked") return { arrangement: "stacked", images: all.map(at(1)), columns: 1 };

  switch (block.layout) {
    case "slideshow":
      return { arrangement: "single", images: all.slice(0, 1).map(at(1)), columns: 1 };
    case "filmstrip": {
      const columns = Math.min(all.length, FILMSTRIP_PRINT_THUMBS);
      const stage = all.slice(0, 1).map(at(1));
      return {
        arrangement: "filmstrip",
        images: [...stage, ...all.map(at(1 / FILMSTRIP_PRINT_THUMBS))],
        columns
      };
    }
    case "feature": {
      const [main, ...details] = imagesForLayout("feature", all);
      return {
        arrangement: "feature",
        images: [...(main ? [at(2 / 3)(main)] : []), ...details.map(at(1 / 3))],
        columns: 2
      };
    }
    case "strip": {
      const columns = stripColumns(all.length);
      return { arrangement: "strip", images: all.map(at(1 / columns)), columns };
    }
    case "masonry": {
      const columns = Math.min(all.length, MASONRY_PRINT_COLUMNS);
      return { arrangement: "masonry", images: all.map(at(1 / columns)), columns };
    }
    case "compare":
      return {
        arrangement: "compare",
        images: imagesForLayout("compare", all).map(at(1 / 2)),
        columns: 2
      };
  }
}

/**
 * The longest edge a picture needs, given the template's limit for a picture
 * as wide as the text and the share of that width it takes.
 *
 * A strip tile a quarter of the text wide read at full size is four times the
 * bytes for nothing, and a long filmstrip at full size would run into the
 * job's picture budget. Never below a floor, so a thumbnail stays sharp.
 */
export function pictureEdge(templateMaxPx: number, width: number): number {
  const share = Math.min(1, Math.max(0, width));
  return Math.max(MIN_PICTURE_EDGE, Math.ceil(templateMaxPx * share));
}

const MIN_PICTURE_EDGE = 400;
