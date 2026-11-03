/**
 * The colour behind a card's picture when the base fits it whole.
 *
 * A cards view set to fit its pictures leaves bands beside or above each one,
 * and Obsidian paints them one grey for every card. A diagram on white paper
 * then sits in a grey frame it does not have. The bands read as part of the
 * picture when they take the colour its edge mostly is, so that is the colour
 * worked out here, from the pixels alone; reading them off the page is the
 * controller's.
 */

/** The side a picture is drawn down to before its edge is read; the edge of a thumbnail is the edge. */
export const COVER_SAMPLE_PX = 64;

/** Below this alpha a pixel shows what is behind the picture, not the picture. */
const OPAQUE_ALPHA = 128;

/** The picture a cover draws, from its `background-image`; null when it draws none. */
export function coverImageUrl(backgroundImage: string): string | null {
  const match = /^url\((["']?)(.+)\1\)$/.exec(backgroundImage.trim());
  return match?.[2] ?? null;
}

/**
 * The colour most of a picture's outermost pixels share, as `rgb(r, g, b)`.
 *
 * The most common colour rather than the mean: a white page with a coloured
 * box touching one edge is a white page, and a mean would tint it. Pixels
 * are grouped coarsely, so the grain of a scan or a JPEG still counts as one
 * colour, and the group's own pixels are averaged. Null when the edge is
 * mostly clear: a cut-out lets the theme show through, and so should the band.
 */
export function edgeColor(pixels: ArrayLike<number>, width: number, height: number): string | null {
  if (width < 1 || height < 1 || pixels.length < width * height * 4) return null;
  const groups = new Map<number, { count: number; r: number; g: number; b: number }>();
  let clear = 0;
  let total = 0;
  const visit = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    total++;
    if ((pixels[at + 3] ?? 0) < OPAQUE_ALPHA) {
      clear++;
      return;
    }
    const r = pixels[at] ?? 0;
    const g = pixels[at + 1] ?? 0;
    const b = pixels[at + 2] ?? 0;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const group = groups.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    group.count++;
    group.r += r;
    group.g += g;
    group.b += b;
    groups.set(key, group);
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    if (height > 1) visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y);
    if (width > 1) visit(width - 1, y);
  }
  // At least one pixel is opaque past this, so there is a group to pick.
  if (clear * 2 > total) return null;
  const best = [...groups.values()].reduce((a, b) => (b.count > a.count ? b : a));
  const mean = (sum: number) => Math.round(sum / best.count);
  return `rgb(${mean(best.r)}, ${mean(best.g)}, ${mean(best.b)})`;
}
