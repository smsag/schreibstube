/**
 * Which pages of a preview are held as drawn pictures.
 *
 * A page of the preview is a canvas as wide as the panel at the screen's
 * pixel density: about seven megabytes for a slide on a phone. Drawing every
 * page of a sixty-slide deck would hold four hundred, which a phone does not
 * have, so a page is drawn when it comes near the view and let go again when
 * enough others have been drawn since. Only the choice lives here; the
 * drawing is `pdf/pdf-preview.ts`.
 */

/** Pages held drawn at most, near the view or not. */
export const PREVIEW_KEEP_PAGES = 8;

/** Pages drawn before the preview is shown, so it never opens blank. */
export const PREVIEW_FIRST_PAGES = 2;

/**
 * The drawn pages to let go: none of those near the view, and of the rest the
 * farthest from it first, until no more than `keep` are held. `drawn` is in
 * the order the pages were drawn.
 */
export function pagesToRelease(
  drawn: readonly number[],
  near: ReadonlySet<number>,
  keep: number = PREVIEW_KEEP_PAGES
): number[] {
  const excess = drawn.length - Math.max(keep, near.size);
  if (excess <= 0) return [];
  const anchors = [...near];
  const distance = (page: number): number =>
    anchors.length === 0 ? 0 : Math.min(...anchors.map((anchor) => Math.abs(anchor - page)));
  return drawn
    .filter((page) => !near.has(page))
    .map((page, order) => ({ page, order, distance: distance(page) }))
    .sort((a, b) => b.distance - a.distance || a.order - b.order)
    .slice(0, excess)
    .map((entry) => entry.page);
}
