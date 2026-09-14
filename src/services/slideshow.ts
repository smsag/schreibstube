/**
 * The ```schreibstube-slideshow``` block: two or more images shown one at a
 * time, with prev/next controls and a fullscreen view.
 *
 * This module is the decision half — it turns the block's text into a list of
 * images or an error, and knows nothing about Obsidian or the DOM. The block's
 * body is note text a person edits by hand, so it is untrusted: every line is
 * validated, and the image count is bounded so a pathological block cannot ask
 * the renderer to build ten thousand slides.
 */
import { t } from "../i18n";

export const SLIDESHOW_LANGUAGE = "schreibstube-slideshow";

/** A slideshow is at least two images; one image is a picture, not a show. */
export const MIN_SLIDESHOW_IMAGES = 2;

/** The upper bound on a single block. A note is written by hand, so this is a
 *  guard against a runaway paste, not a limit anyone reaches on purpose. */
export const MAX_SLIDESHOW_IMAGES = 100;

/** The empty block inserted at the cursor, with two placeholder lines so the
 *  shape is obvious and the block renders instead of erroring on insert. */
export const SLIDESHOW_SNIPPET =
  "```" + SLIDESHOW_LANGUAGE + "\n![](image-one.png)\n![](image-two.png)\n```";

export interface SlideshowImage {
  src: string;
  alt: string;
}

export type SlideshowResult =
  { ok: true; images: SlideshowImage[] } | { ok: false; message: string };

// A whole-line Markdown image: ![alt](path). Alt may be empty; the path may not.
const IMAGE_PATTERN = /^!\[([^\]]*)\]\(([^)]+)\)$/;

/**
 * Reads the block into images.
 *
 * One Markdown image per line. Blank lines and `//` comments are ignored so a
 * block can be annotated. Any other line is an error naming its number, rather
 * than being dropped silently, because a mistyped image is a mistake the writer
 * wants pointed out.
 */
export function parseSlideshow(source: string): SlideshowResult {
  const lines = source.split(/\r?\n/);
  const images: SlideshowImage[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (line === "" || line.startsWith("//")) continue;

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

  return { ok: true, images };
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
