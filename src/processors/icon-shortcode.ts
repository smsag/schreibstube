/**
 * Drawing `:folder:` as the glyph, in the editor and in Reading view.
 *
 * Two renderers for one rule. Live Preview is CodeMirror: the shortcode is
 * replaced by a widget holding the glyph, except where the cursor or a
 * selection touches it, which is when a person is editing it and needs to
 * see the colons. Reading view is HTML: the text nodes are walked and each
 * shortcode becomes a span, skipping code, links and anything else that is
 * not prose.
 *
 * Where a shortcode counts is decided once, in `services/icon-shortcode`,
 * over the same prose segmentation the proofreader uses. This file only
 * draws what it is told.
 */

import type { Plugin } from "obsidian";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { findShortcodes, type ShortcodeHit } from "../services/icon-shortcode";
import { applyIcon, iconGlyph, installIconFont } from "../ui/icon-font";
import { MAX_LIVE_CHARS } from "./live-limits";

const isIcon = (name: string): boolean => iconGlyph(name) !== undefined;

/** The glyph in place of the text, with the text as its tooltip. */
class IconWidget extends WidgetType {
  constructor(private readonly name: string) {
    super();
  }

  override eq(other: IconWidget): boolean {
    return other.name === this.name;
  }

  override toDOM(view: EditorView): HTMLElement {
    installIconFont(view.dom.doc);
    const span = view.dom.doc.createElement("span");
    span.className = "schreibstube-icon-shortcode";
    span.title = `:${this.name}:`;
    applyIcon(span, this.name);
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Live Preview: shortcodes become glyphs, except under the cursor.
 *
 * Only the lines on screen are read, and only when they change or the view
 * scrolls: a cursor move keeps the hits it found and merely decides again
 * which of them the cursor is on, so walking the text is never the cost of
 * a keystroke. Read per visible line rather than from the top, a fence that
 * opened above the screen is not seen; the cap on the note's length is what
 * keeps that trade honest, since a note within it is prose.
 */
export function createIconShortcodeExtension(enabled: () => boolean): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      /** What the last scan found on screen, in document positions. */
      private hits: ShortcodeHit[] = [];
      /** Whether the setting was on at the last scan; a toggle is a reason to scan again. */
      private on = false;

      constructor(view: EditorView) {
        this.scan(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || enabled() !== this.on) {
          this.scan(update.view);
        } else if (update.selectionSet) {
          this.draw(update.view);
        }
      }

      private scan(view: EditorView): void {
        this.hits = [];
        this.on = enabled();
        if (!this.on || view.state.doc.length > MAX_LIVE_CHARS) {
          this.decorations = Decoration.none;
          return;
        }
        const doc = view.state.doc;
        for (const range of view.visibleRanges) {
          // Whole lines, so a shortcode cut by the edge of the screen is read
          // as the word it is rather than as its first half.
          const from = doc.lineAt(range.from).from;
          const to = doc.lineAt(range.to).to;
          for (const hit of findShortcodes(doc.sliceString(from, to), isIcon)) {
            this.hits.push({ ...hit, from: hit.from + from, to: hit.to + from });
          }
        }
        this.draw(view);
      }

      private draw(view: EditorView): void {
        const ranges = view.state.selection.ranges;
        const builder = new RangeSetBuilder<Decoration>();
        for (const hit of this.hits) {
          // A cursor inside or at either edge of the shortcode is editing it.
          const touched = ranges.some((range) => range.from <= hit.to && range.to >= hit.from);
          if (touched) continue;
          builder.add(hit.from, hit.to, Decoration.replace({ widget: new IconWidget(hit.name) }));
        }
        this.decorations = builder.finish();
      }
    },
    { decorations: (value) => value.decorations }
  );
}

/** Elements whose text is never prose, however it reads. */
const NOT_PROSE = "code, pre, a, .math, .frontmatter, .cm-inline-code";

/**
 * Reading view: shortcodes in the rendered HTML become glyph spans.
 *
 * Obsidian hands over each rendered section; its text nodes are read and
 * only those outside code and links are touched. A text node is split at
 * each shortcode rather than replaced wholesale, so the words around a
 * glyph keep their own node and anything else that decorated them.
 */
export function registerIconShortcodePostProcessor(plugin: Plugin, enabled: () => boolean): void {
  plugin.registerMarkdownPostProcessor((el) => {
    if (!enabled()) return;
    const doc = el.doc;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (text.parentElement?.closest(NOT_PROSE)) continue;
      if (text.data.includes(":")) nodes.push(text);
    }
    if (nodes.length === 0) return;

    installIconFont(doc);
    for (const node of nodes) drawInto(node, doc);
  });
}

function drawInto(node: Text, doc: Document): void {
  const hits = findShortcodes(node.data, isIcon);
  if (hits.length === 0) return;

  const parent = node.parentNode;
  if (!parent) return;
  const pieces = doc.createDocumentFragment();
  let at = 0;
  for (const hit of hits) {
    if (hit.from > at) pieces.appendChild(doc.createTextNode(node.data.slice(at, hit.from)));
    const span = doc.createElement("span");
    span.className = "schreibstube-icon-shortcode";
    span.title = `:${hit.name}:`;
    applyIcon(span, hit.name);
    pieces.appendChild(span);
    at = hit.to;
  }
  if (at < node.data.length) pieces.appendChild(doc.createTextNode(node.data.slice(at)));
  parent.replaceChild(pieces, node);
}
