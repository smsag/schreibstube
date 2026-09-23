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
import { findShortcodes } from "../services/icon-shortcode";
import { applyIcon, iconGlyph, installIconFont } from "../ui/icon-font";

/** Above this the editor is left alone; a note this long is not prose. */
const MAX_LIVE_CHARS = 200_000;

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
 * Rebuilt on every change and every cursor move rather than on a timer:
 * the scan is a regex over prose, cheap enough that a delay would only
 * make the glyph flicker into place after the fact.
 */
export function createIconShortcodeExtension(enabled: () => boolean): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.decorations = build(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (value) => value.decorations }
  );

  function build(view: EditorView): DecorationSet {
    const text = view.state.doc.toString();
    if (!enabled() || text.length > MAX_LIVE_CHARS) return Decoration.none;

    const ranges = view.state.selection.ranges;
    const builder = new RangeSetBuilder<Decoration>();
    for (const hit of findShortcodes(text, isIcon)) {
      // A cursor inside or at either edge of the shortcode is editing it.
      const touched = ranges.some((range) => range.from <= hit.to && range.to >= hit.from);
      if (touched) continue;
      builder.add(hit.from, hit.to, Decoration.replace({ widget: new IconWidget(hit.name) }));
    }
    return builder.finish();
  }
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
