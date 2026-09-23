/**
 * What a finger did on a slideshow, from where it landed to where it lifted.
 *
 * A block on a phone answers three things: a sideways swipe turns the page,
 * a tap shows or hides the header's contents, and everything else is the
 * note being scrolled and is none of the block's business. Telling them
 * apart is a decision, so it is decided here and tested here; the processor
 * only reads touch events and asks.
 */

/** How far sideways a finger has to travel before its lift turns the page. */
export const SWIPE_THRESHOLD_PX = 40;

/**
 * How far a finger may wander and still be a tap.
 *
 * A finger never holds perfectly still, and a tap that had to be exact
 * would be a tap that mostly fails.
 */
export const TAP_SLOP_PX = 10;

export type TouchGesture = "next" | "previous" | "tap" | "none";

/**
 * The gesture a finger completed, from its total travel.
 *
 * Measured on the width alone, a thumb scrolling the note down with a little
 * drift to the side turned the page. A swipe has to travel further sideways
 * than up or down, which is what makes it a swipe and not a scroll; and a
 * page turn goes against the direction of the finger, as pages do.
 */
export function classifyTouch(dx: number, dy: number): TouchGesture {
  const across = Math.abs(dx);
  const along = Math.abs(dy);
  if (across <= TAP_SLOP_PX && along <= TAP_SLOP_PX) return "tap";
  if (across > SWIPE_THRESHOLD_PX && across > along) return dx < 0 ? "next" : "previous";
  return "none";
}

/**
 * Whether a touch still in progress has become a sideways drag the block
 * should claim for itself.
 *
 * Claimed early, at the tap slop rather than the swipe threshold: the point
 * of claiming is to keep the move from whoever else is watching it — the
 * browser, which would scroll, and the host, whose own sideways gesture
 * slides a sidebar in over the note — and by the time a swipe is certain
 * they have both already acted. A drag that starts sideways stays claimed
 * however it curves afterwards; the caller keeps that.
 */
export function claimsHorizontal(dx: number, dy: number): boolean {
  return Math.abs(dx) > TAP_SLOP_PX && Math.abs(dx) > Math.abs(dy);
}
