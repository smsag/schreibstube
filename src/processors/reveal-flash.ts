/**
 * A short-lived mark where "Show passage" landed.
 *
 * The button selected the passage and scrolled it into view, but the press
 * leaves the focus in the review panel, and a selection in an editor without
 * the focus is drawn in the faint grey of an inactive one: the note moved and
 * nothing said where to look. The editor now draws the place itself — a tint
 * over the passage and a bar beside its lines, or a caret-like mark at an
 * insertion point — for a moment, and takes it away at the next edit.
 *
 * Decorations rather than a second selection, so the person's own selection
 * and focus are left exactly as they were.
 */

import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { isElementLike } from "../services/workspace-internals";

/** How long the mark stays: long enough to find it after the scroll, short
 *  enough not to read as a highlight the note now has. Matches the fade in
 *  styles.css, which ends exactly then. */
export const REVEAL_FLASH_MS = 2600;

/** What to mark: a passage, and for an insertion the point it goes in. */
export interface RevealTarget {
  from: number;
  to: number;
  /** Where an insertion lands, drawn as a mark of its own; null for a passage. */
  point: number | null;
}

type FlashEffect = { id: number; target: RevealTarget } | { id: number; target: null };

const flashEffect = StateEffect.define<FlashEffect>();

const PASSAGE = Decoration.mark({ class: "schreibstube-reveal-flash" });
const LINE = Decoration.line({ class: "schreibstube-reveal-line" });

class PointWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const mark = document.createElement("span");
    mark.className = "schreibstube-reveal-point";
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }
}

const POINT = Decoration.widget({ widget: new PointWidget(), side: 1 });

/** The decorations for one target, clamped to the document as it is now. */
export function buildRevealDecorations(doc: Text, target: RevealTarget): DecorationSet {
  const clamp = (value: number): number => Math.max(0, Math.min(doc.length, value));
  const from = clamp(Math.min(target.from, target.to));
  const to = clamp(Math.max(target.from, target.to));
  const ranges = [];

  // The bar spans every line the passage touches; a passage ending at a line's
  // start does not reach into that line.
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to > from ? to - 1 : to).number;
  for (let n = first; n <= last; n++) ranges.push(LINE.range(doc.line(n).from));

  if (to > from) ranges.push(PASSAGE.range(from, to));
  if (target.point !== null) ranges.push(POINT.range(clamp(target.point)));

  return Decoration.set(ranges, true);
}

/**
 * The mark in the editor's state. An edit takes it away at once — a tint on
 * text that has just been changed would point at a place that is no longer
 * the one it named — and so does its own timer, which only clears the mark it
 * set: a second reveal within the window is not cut short by the first one's.
 */
export const revealFlashField = StateField.define<{ id: number; set: DecorationSet }>({
  create: () => ({ id: 0, set: Decoration.none }),
  update(value, tr) {
    let next = tr.docChanged && value.set.size > 0 ? { id: value.id, set: Decoration.none } : value;
    for (const effect of tr.effects) {
      if (!effect.is(flashEffect)) continue;
      const { id, target } = effect.value;
      if (target !== null) next = { id, set: buildRevealDecorations(tr.state.doc, target) };
      else if (id === next.id) next = { id, set: Decoration.none };
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.set)
});

export const revealFlashExtension: Extension = revealFlashField;

let lastId = 0;

/** The effects that set a mark and later clear it, for a dispatch. */
export function revealFlashEffects(target: RevealTarget): {
  show: StateEffect<FlashEffect>;
  clear: StateEffect<FlashEffect>;
} {
  const id = ++lastId;
  return { show: flashEffect.of({ id, target }), clear: flashEffect.of({ id, target: null }) };
}

/**
 * Mark `target` in the editor inside `container` — a Markdown view's content.
 *
 * Found through CodeMirror's own `findFromDOM`, which is public API, and
 * feature-detected because Obsidian supplies CodeMirror: an editor without it
 * keeps the selection alone, as before. Returns whether a mark was drawn.
 */
export function flashRevealIn(container: HTMLElement, target: RevealTarget): boolean {
  const dom = container.querySelector(".cm-editor");
  if (!isElementLike(dom) || typeof EditorView.findFromDOM !== "function") return false;
  const view = EditorView.findFromDOM(dom);
  if (!view || view.state.field(revealFlashField, false) === undefined) return false;

  const { show, clear } = revealFlashEffects(target);
  view.dispatch({ effects: show });
  window.setTimeout(() => {
    // The note may have been closed meanwhile; a destroyed view has no DOM
    // left to take the mark off.
    if (view.dom.isConnected) view.dispatch({ effects: clear });
  }, REVEAL_FLASH_MS);
  return true;
}
