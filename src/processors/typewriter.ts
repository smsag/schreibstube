/**
 * Typewriter mode in the editor (services/typewriter).
 *
 * Registered for every editor and idle in all but those inside an element
 * that carries the class: the mode belongs to one view, the one New note
 * opens with the link's flag, and the class is what controllers/draft-focus
 * puts on that view and takes off again.
 */

import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { typewriterFollows, typewriterScrollDelta } from "../services/typewriter";

/** Marks a view in typewriter mode; styles.css gives its text the room to scroll. */
export const TYPEWRITER_CLASS = "schreibstube-typewriter";

/**
 * Scrolls the cursor's line to the middle, in the editor's measure cycle:
 * the position is read with the layout settled and the scroll written after
 * every read, so the scroll forces no layout of its own.
 */
export function centreCursorLine(view: EditorView): void {
  view.requestMeasure({
    read: (v) => {
      const caret = v.coordsAtPos(v.state.selection.main.head);
      if (!caret) return 0;
      return typewriterScrollDelta(caret, v.scrollDOM.getBoundingClientRect());
    },
    write: (delta, v) => {
      if (delta !== 0) v.scrollDOM.scrollTop += delta;
    }
  });
}

export const typewriterExtension = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate): void {
      if (!update.view.dom.closest(`.${TYPEWRITER_CLASS}`)) return;
      const follows = typewriterFollows({
        docChanged: update.docChanged,
        cursorMoved:
          update.selectionSet &&
          update.startState.selection.main.head !== update.state.selection.main.head,
        pointer: update.transactions.some((tr) => tr.isUserEvent("select.pointer"))
      });
      if (follows) centreCursorLine(update.view);
    }
  }
);
