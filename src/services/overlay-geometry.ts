/**
 * How tall the heading overlay is for each depth of the stack.
 *
 * The overlay is a padded column of rows, so its height grows by one row
 * pitch per heading. Which line it covers has to be asked for every depth it
 * could take (see `resolveStackUnderOverlay`), including depths it has not
 * been drawn at, so the height is computed from the overlay as last drawn
 * rather than read off it.
 */

export interface OverlayMetrics {
  /** Padding and border, less the one gap that has no row after it. */
  chrome: number;
  /** One row and the gap under it. */
  rowPitch: number;
}

/** The overlay as the stylesheet draws it, until it has been drawn once. */
export const FALLBACK_OVERLAY_METRICS: OverlayMetrics = { chrome: 9, rowPitch: 24 };

/** The deepest a stack gets: one row per heading level. */
export const MAX_STACK_DEPTH = 6;

export interface OverlaySample {
  overlayHeight: number;
  listHeight: number;
  rows: number;
  gap: number;
}

/** The metrics of an overlay on screen, or null when it shows no rows to measure. */
export function measureOverlayMetrics(sample: OverlaySample): OverlayMetrics | null {
  const { overlayHeight, listHeight, rows, gap } = sample;
  if (rows <= 0 || overlayHeight <= 0 || listHeight <= 0) return null;
  const rowPitch = (listHeight + Math.max(0, gap)) / rows;
  return { chrome: overlayHeight - rows * rowPitch, rowPitch };
}

/** The overlay's height at each depth from 0 to `MAX_STACK_DEPTH`; empty, it draws nothing. */
export function overlayHeightsByDepth(metrics: OverlayMetrics): number[] {
  return Array.from({ length: MAX_STACK_DEPTH + 1 }, (_, depth) =>
    depth === 0 ? 0 : Math.max(0, metrics.chrome + depth * metrics.rowPitch)
  );
}
