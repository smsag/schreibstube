/**
 * A jump to a row, waiting for the draw that can make it.
 *
 * The pane scrolls to a note when it opens, and to a folder a bookmark names.
 * A pane in a shut sidebar — on a phone, every time a note opens — has no
 * layout to scroll, so the jump waits for a draw that has one. What it must not
 * do is land on a draw the person caused by folding something: that pulled the
 * pane away from the folder they had just opened or closed.
 */

/** Where the row stands in the draw that just happened. */
export type RowState = "missing" | "without-layout" | "on-screen";

export interface Reveal {
  path: string;
  /** Followed a note being opened rather than a request: scrolls only if the
   *  row is out of view, and does not flash. */
  quietly: boolean;
}

export class PendingReveal {
  private pending: Reveal | null = null;

  /** Ask for a jump to `path` on the next draw that can make it. */
  request(path: string, quietly: boolean): void {
    this.pending = { path, quietly };
  }

  /** The person folded or unfolded something: the waiting jump is dropped. */
  browsed(): void {
    this.pending = null;
  }

  /** The path waiting, if any, for the draw to look its row up. */
  get path(): string | null {
    return this.pending?.path ?? null;
  }

  /**
   * After a draw: the jump to make now, or null.
   *
   * A row without a layout keeps the jump waiting. A row not drawn at all —
   * filtered out, in a closed section — ends it: there is nothing to wait for.
   */
  settle(row: RowState): Reveal | null {
    const pending = this.pending;
    if (pending === null || row === "without-layout") return null;

    this.pending = null;
    return row === "on-screen" ? pending : null;
  }
}
