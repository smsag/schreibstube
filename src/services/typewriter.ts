/**
 * Typewriter mode: the line being written stays in the middle of the screen,
 * and the text moves past it, as paper moves past a typewriter's platen.
 *
 * Writing at the bottom edge of a window puts the eye there for the length
 * of a draft; keeping the line at one height leaves the eye where it is and
 * gives the line just written the room above it.
 */

/** What happened in one editor update, as far as the mode cares. */
export interface TypewriterUpdate {
  docChanged: boolean;
  selectionSet: boolean;
  /** The selection was set with the mouse or a finger. */
  pointer: boolean;
}

/**
 * Whether an update brings the cursor's line back to the middle.
 *
 * Typing and moving with the keys do. A click or a drag does not: the place
 * pressed would slide away from under the pointer, and a selection being
 * dragged out would run off with it. The next key brings the line back.
 */
export function typewriterFollows(update: TypewriterUpdate): boolean {
  if (update.pointer) return false;
  return update.docChanged || update.selectionSet;
}

/** A vertical span on the screen, in pixels from the top of the window. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * How far to scroll so the cursor's line sits in the middle of the scroller.
 *
 * Positive scrolls the text up. A half pixel either way is left alone, so a
 * line already in the middle does not shiver from rounding.
 */
export function typewriterScrollDelta(caret: Span, scroller: Span): number {
  if (![caret.top, caret.bottom, scroller.top, scroller.bottom].every(Number.isFinite)) return 0;
  if (scroller.bottom <= scroller.top) return 0;
  const delta = (caret.top + caret.bottom) / 2 - (scroller.top + scroller.bottom) / 2;
  return Math.abs(delta) < 0.5 ? 0 : delta;
}
