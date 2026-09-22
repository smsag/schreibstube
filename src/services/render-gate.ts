/**
 * When a panel that rebuilds itself is allowed to rebuild.
 *
 * The review panel redraws from scratch on every state change — `empty()`
 * followed by a fresh tree — and eighteen places change state, most of them
 * nothing to do with the person's finger: a glossary parse finishing, a source
 * check returning, staleness recomputed as they type.
 *
 * If one lands mid-tap, the button under the finger is destroyed and an
 * identical one takes its place, and the browser has nothing to raise a click
 * on. The tap looks like it worked and does nothing; the second one counts.
 *
 * MEASURED, in Obsidian: replacing the button between the release and the
 * click loses the click outright — a `setTimeout(…, 0)` from a `pointerup`
 * handler runs BEFORE the browser dispatches that press's click, so "redraw
 * once the finger is up" is not late enough. The gate stays shut until the
 * click has been delivered, and a gesture that never becomes a click opens it
 * on a timer instead.
 *
 * A latch, not a count: two fingers are not what this is about, and a count
 * that can be released more often than it is held sticks shut for ever.
 */
export class RenderGate<T> {
  private open = true;
  private pending: { value: T } | null = null;

  /** A tap has started. Hold redraws until it has resolved. */
  hold(): void {
    this.open = false;
  }

  /**
   * The tap resolved. Returns the state held back, or null when nothing was
   * requested while it was shut. Safe to call when already open.
   */
  release(): T | null {
    this.open = true;
    const held = this.pending;
    this.pending = null;
    return held ? held.value : null;
  }

  /**
   * A redraw is wanted with this state. Returns the state to draw now, or
   * null when it has been held back instead.
   *
   * Only the latest state is kept: a redraw paints the current state, and the
   * ones in between were never on screen.
   */
  request(value: T): T | null {
    if (this.open) return value;
    this.pending = { value };
    return null;
  }

  /** Whether a redraw is being held back. */
  get holding(): boolean {
    return !this.open;
  }
}
