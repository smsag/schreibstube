/**
 * The ```schreibstube-slideshow``` block: two or more images, shown one at a
 * time, as one scene with its details, or as a strip.
 *
 * This module is the decision half — it turns the block's text into a list of
 * images and a layout, or an error, and knows nothing about Obsidian or the
 * DOM. The block's body is note text a person edits by hand, so it is
 * untrusted: every line is validated, and the image count is bounded so a
 * pathological block cannot ask the renderer to build ten thousand slides.
 *
 * Which images a layout shows where, and what its footer says, are decided
 * here as well, so the renderer only has to draw what it is handed.
 */
import { t } from "../i18n";

export const SLIDESHOW_LANGUAGE = "schreibstube-slideshow";

/** A slideshow is at least two images; one image is a picture, not a show. */
export const MIN_SLIDESHOW_IMAGES = 2;

/** The upper bound on a single block. A note is written by hand, so this is a
 *  guard against a runaway paste, not a limit anyone reaches on purpose. */
export const MAX_SLIDESHOW_IMAGES = 100;

/**
 * How the images are arranged.
 *
 * `slideshow` is one stage with one image on it, the way the block has always
 * rendered. `feature` puts one image large with two details beside it, for a
 * scene the reader should take in at once. `strip` sets every image in a row
 * of equal tiles, for a series that makes one statement together.
 */
export type SlideshowLayout = "slideshow" | "feature" | "strip";

export const SLIDESHOW_LAYOUTS: readonly SlideshowLayout[] = ["slideshow", "feature", "strip"];

export const DEFAULT_SLIDESHOW_LAYOUT: SlideshowLayout = "slideshow";

/** A strip wider than this wraps: five equal tiles across a note column are
 *  thumbnails, not pictures. */
export const MAX_STRIP_COLUMNS = 4;

/** What a wrapped strip settles on, so two rows read as one series rather
 *  than a full row over a short one. */
export const STRIP_WRAP_COLUMNS = 3;

/** How many details stand beside the featured image. Two stack into a column
 *  as tall as the large picture; a third would shrink them to stamps. */
export const FEATURE_DETAIL_COUNT = 2;

/** The empty block inserted at the cursor, with two placeholder lines so the
 *  shape is obvious and the block renders instead of erroring on insert. */
export const SLIDESHOW_SNIPPET =
  "```" + SLIDESHOW_LANGUAGE + "\n![](image-one.png)\n![](image-two.png)\n```";

export interface SlideshowImage {
  src: string;
  alt: string;
}

export interface SlideshowBlock {
  images: SlideshowImage[];
  layout: SlideshowLayout;
  /** The header's text for `feature` and `strip`; the `slideshow` layout keeps
   *  the active image's alt text there and leaves this unused. */
  title: string;
  /** One caption for the whole block, where a layout has room for one. */
  caption: string;
}

export type SlideshowResult = ({ ok: true } & SlideshowBlock) | { ok: false; message: string };

// A whole-line Markdown image: ![alt](path). Alt may be empty; the path may not.
const IMAGE_PATTERN = /^!\[([^\]]*)\]\(([^)]+)\)$/;

// An option line: a known key, a colon, the value. Keys are matched without
// regard to case, so `Layout:` is not a mistyped image.
const OPTION_PATTERN = /^(layout|title|caption)\s*:\s*(.*)$/i;

/**
 * Reads the block into images and a layout.
 *
 * One Markdown image per line. Blank lines and `//` comments are ignored so a
 * block can be annotated, and `layout:`, `title:` and `caption:` lines may sit
 * anywhere at the top level. Any other line is an error naming its number,
 * rather than being dropped silently, because a mistyped image is a mistake
 * the writer wants pointed out.
 */
export function parseSlideshow(source: string): SlideshowResult {
  const lines = source.split(/\r?\n/);
  const images: SlideshowImage[] = [];
  let layout: SlideshowLayout = DEFAULT_SLIDESHOW_LAYOUT;
  let title = "";
  let caption = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (line === "" || line.startsWith("//")) continue;

    const option = OPTION_PATTERN.exec(line);
    if (option) {
      const key = (option[1] ?? "").toLowerCase();
      const value = (option[2] ?? "").trim();
      if (key === "title") {
        title = value;
      } else if (key === "caption") {
        caption = value;
      } else {
        const chosen = parseLayout(value);
        if (chosen === null) {
          return {
            ok: false,
            message: t().slideshow.unknownLayout(i + 1, value, SLIDESHOW_LAYOUTS.join(", "))
          };
        }
        layout = chosen;
      }
      continue;
    }

    const match = IMAGE_PATTERN.exec(line);
    if (!match) {
      return { ok: false, message: t().slideshow.notImage(i + 1, line) };
    }

    const alt = (match[1] ?? "").trim();
    const src = (match[2] ?? "").trim();
    if (src === "") {
      return { ok: false, message: t().slideshow.emptyPath(i + 1) };
    }

    if (images.length >= MAX_SLIDESHOW_IMAGES) {
      return { ok: false, message: t().slideshow.tooMany(MAX_SLIDESHOW_IMAGES) };
    }
    images.push({ src, alt });
  }

  if (images.length < MIN_SLIDESHOW_IMAGES) {
    return { ok: false, message: t().slideshow.tooFew(MIN_SLIDESHOW_IMAGES) };
  }

  return { ok: true, images, layout, title, caption };
}

/** The layout a `layout:` value names, or null when it names none. */
export function parseLayout(value: string): SlideshowLayout | null {
  const wanted = value.trim().toLowerCase();
  return SLIDESHOW_LAYOUTS.find((layout) => layout === wanted) ?? null;
}

/**
 * How many tiles a strip sets side by side.
 *
 * Up to four images stand in one row. More than that wraps, and wraps to
 * three rather than four so the rows are alike: six images as two rows of
 * three read as one series, where four over two read as a row and a remainder.
 */
export function stripColumns(count: number): number {
  if (count <= 0) return 1;
  return count <= MAX_STRIP_COLUMNS ? count : STRIP_WRAP_COLUMNS;
}

/**
 * The indices of the details beside the featured image: the ones after it,
 * in order, wrapping round to the start. With two images there is one detail;
 * the layout gives it the whole column.
 */
export function featureDetails(count: number, active: number): number[] {
  if (count <= 1) return [];
  const details: number[] = [];
  const wanted = Math.min(FEATURE_DETAIL_COUNT, count - 1);
  for (let step = 1; step <= wanted; step++) {
    details.push((((active + step) % count) + count) % count);
  }
  return details;
}

/** The index reached from `active` by `step`, wrapping in either direction. */
export function stepIndex(active: number, step: number, count: number): number {
  if (count <= 0) return 0;
  return (((active + step) % count) + count) % count;
}

/** The `2 / 6` a viewer reads to know where in the series they are. */
export function slideshowCounter(active: number, count: number): string {
  return `${active + 1} / ${count}`;
}

/**
 * What the footer says under a feature layout: the block's own caption when
 * it has one, else the featured image's alt text — a shared caption is what
 * the writer meant the whole block to say, and it should not change as the
 * reader clicks through.
 */
export function footerCaption(images: SlideshowImage[], active: number, caption: string): string {
  if (caption !== "") return caption;
  return images[active]?.alt ?? "";
}

/**
 * The text to insert at the cursor so the block lands on lines of its own,
 * whatever is on either side of the cursor. Mirrors the task ribbon's insert.
 */
export function buildSlideshowInsertion(textBeforeCursor: string, textAfterCursor: string): string {
  const prefix = textBeforeCursor.trim().length > 0 ? "\n" : "";
  const suffix = textAfterCursor.trim().length > 0 ? "\n" : "";
  return `${prefix}${SLIDESHOW_SNIPPET}\n${suffix}`;
}
