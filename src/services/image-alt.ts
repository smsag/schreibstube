/**
 * What an image's alt text says beyond its caption, read the way the screen
 * reads it.
 *
 * Obsidian takes a width from the last `|` segment only: `![Map | 300](m.png)`
 * and `![[m.png|300]]` are 300 CSS pixels wide, `![Map | 300 | x](m.png)` is
 * not sized at all. The Klartext theme takes an alignment word from the
 * segment before the width, or from the last one when there is no width:
 * `![Map | center | 300](m.png)`, `![Map | right](m.png)`. A print that
 * placed a picture differently from the note would be a page that disagrees
 * with what its author arranged, so the rule is the same, segment for segment.
 */

export type ImageAlign = "left" | "center" | "right";

export interface ImageAlt {
  /** What is left once the width and the alignment word are taken off. */
  caption: string;
  /** In CSS pixels, as Obsidian draws it; null when the note gives none. */
  width: number | null;
  align: ImageAlign | null;
}

/**
 * Wider than any page a picture lands on; the template clamps to the text
 * width anyway. The bound is there so a run of digits cannot become a number
 * Typst would read in exponent form.
 */
export const MAX_IMAGE_WIDTH_PX = 10_000;

const SIZE = /^(\d+)(?:x\d+)?$/;
const ALIGNS: readonly ImageAlign[] = ["left", "center", "right"];

export function parseImageAlt(alt: string): ImageAlt {
  const segments = alt.split("|").map((segment) => segment.trim());

  let width: number | null = null;
  const size = SIZE.exec(segments[segments.length - 1] ?? "");
  if (size?.[1] !== undefined) {
    segments.pop();
    const pixels = Number(size[1]);
    if (pixels > 0) width = Math.min(pixels, MAX_IMAGE_WIDTH_PX);
  }

  let align: ImageAlign | null = null;
  const word = (segments[segments.length - 1] ?? "").toLowerCase();
  const found = ALIGNS.find((candidate) => candidate === word);
  if (found !== undefined) {
    segments.pop();
    align = found;
  }

  return { caption: segments.join(" | "), width, align };
}
