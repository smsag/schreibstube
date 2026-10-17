/**
 * Which line sits at the top edge of an editor, under the heading overlay.
 *
 * Asked on every scroll, inside CodeMirror's measure cycle, to decide which
 * headings the stack shows. The question is answered with `posAtCoords`, and
 * that call is not safe at every moment: while an editor swaps one document
 * for another its drawn lines are briefly out of step with its state, and
 * CodeMirror throws from inside its own lookup. An exception there ends the
 * whole measure cycle, so the note being opened was never drawn — a press on
 * a note that opened nothing and moved nothing. A heading stack a frame out
 * of date costs nothing; an editor that stops drawing costs the note.
 *
 * Typed against the few members it reads rather than against CodeMirror, so
 * it can be tested with a plain object.
 */

export interface TopEdgeView {
  scrollDOM: { isConnected: boolean; getBoundingClientRect(): Rect };
  contentDOM: { getBoundingClientRect(): Rect };
  posAtCoords(coords: { x: number; y: number }): number | null;
  state: { doc: { length: number; lineAt(pos: number): { number: number } } };
  viewport: { from: number };
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The zero-based line at the top edge, `overlayHeight` pixels below the
 * scroller's top. Falls back to the first line CodeMirror has laid out when
 * the point cannot be resolved, or cannot safely be asked about.
 */
export function topEdgeLine(view: TopEdgeView, overlayHeight: number): number {
  return lineOf(view, positionAtTopEdge(view, overlayHeight) ?? view.viewport.from);
}

function positionAtTopEdge(view: TopEdgeView, overlayHeight: number): number | null {
  // A view detached, or not laid out — a background tab, a pane mid-swap —
  // has no top edge to ask about, and asking is what throws.
  if (!view.scrollDOM.isConnected) return null;
  const scroller = view.scrollDOM.getBoundingClientRect();
  if (scroller.width <= 0 || scroller.height <= 0) return null;

  // Inside the text rather than on the scroller's edge, where a gutter or a
  // margin holds no line to find.
  const content = view.contentDOM.getBoundingClientRect();
  try {
    return view.posAtCoords({
      x: Math.max(scroller.left, content.left) + 1,
      y: scroller.top + Math.max(0, overlayHeight) + 1
    });
  } catch {
    return null;
  }
}

function lineOf(view: TopEdgeView, pos: number): number {
  const clamped = Math.min(Math.max(0, pos), view.state.doc.length);
  return Math.max(0, view.state.doc.lineAt(clamped).number - 1);
}
