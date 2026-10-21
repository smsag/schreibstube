/**
 * Drawing `:folder:` as the glyph, in the editor and in Reading view.
 *
 * Two renderers for one rule. Live Preview is CodeMirror: the shortcode is
 * replaced by a widget holding the glyph, except where the cursor or a
 * selection touches it, which is when a person is editing it and needs to
 * see the colons. Reading view is HTML: the text nodes are walked and each
 * shortcode becomes a span, skipping code, a link that shows its own address
 * and anything else that is not prose. A link's label is prose: `[:folder:
 * Ablage](…)` shows the icon, as it does in the editor.
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
import {
  findShortcodes,
  iconLinkAt,
  isLinkLabel,
  type IconLink,
  type ShortcodeHit
} from "../services/icon-shortcode";
import { applyIcon, iconGlyph, installIconFont } from "../ui/icon-font";
import { MAX_LIVE_CHARS } from "./live-limits";

const isIcon = (name: string): boolean => iconGlyph(name) !== undefined;

/** Follows the link an icon stands in, as a click on the link's words would. */
export type OpenIconLink = (link: IconLink, event: MouseEvent, view: EditorView) => void;

/** A shortcode found on screen, with the link it stands in, if any. */
interface DrawnHit extends ShortcodeHit {
  link: IconLink | null;
}

/** The glyph in place of the text, with the text as its tooltip. */
class IconWidget extends WidgetType {
  constructor(
    private readonly name: string,
    private readonly link: IconLink | null,
    private readonly open: OpenIconLink | null
  ) {
    super();
  }

  override eq(other: IconWidget): boolean {
    return other.name === this.name && JSON.stringify(other.link) === JSON.stringify(this.link);
  }

  override toDOM(view: EditorView): HTMLElement {
    installIconFont(view.dom.doc);
    const span = view.dom.doc.createElement("span");
    span.className = "schreibstube-icon-shortcode";
    span.title = `:${this.name}:`;
    applyIcon(span, this.name);

    const { link, open } = this;
    if (link !== null && open !== null) {
      // The glyph is all there is of the link's words, so it has to be the
      // link: a click follows it, and the cursor stays out, since a cursor
      // on the shortcode shows its source, which is what a click used to do.
      span.addClass("schreibstube-icon-link");
      span.addEventListener("mousedown", (event) => event.preventDefault());
      span.addEventListener("click", (event) => {
        event.preventDefault();
        open(link, event, view);
      });
      span.addEventListener("auxclick", (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        open(link, event, view);
      });
    }
    return span;
  }

  override ignoreEvent(event: Event): boolean {
    return this.link !== null && this.open !== null && event instanceof MouseEvent;
  }
}

/**
 * Live Preview: shortcodes become glyphs, except under the cursor.
 *
 * The note is read from its top to the last line the editor has drawn, and
 * only the shortcodes in the drawn part become glyphs; this happens when the
 * text changes or the view scrolls, and a cursor move merely decides again
 * which of the hits the cursor is on. From the top, because a part read on
 * its own is read without what came before it: a part that began with a `---`
 * rule took it for the start of frontmatter and drew nothing up to the next
 * rule, and one that began inside a fence drew the code. In a note with a
 * rule between its sections, folding one was enough for the icons below it to
 * stay text. The cap on the note's length keeps the read cheap.
 *
 * The drawn range, `viewport`, and not the ranges CodeMirror reckons are on
 * screen: those are measured against the editor's scroll containers, which a
 * theme lays out as it likes, and they split around every fold. The drawn
 * range is one range, never empty in an open note, with a margin either side.
 */
export function createIconShortcodeExtension(
  enabled: () => boolean,
  open: OpenIconLink | null = null
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      /** What the last scan found on screen, in document positions. */
      private hits: DrawnHit[] = [];
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
        // Whole lines, so a shortcode cut by the edge of the drawn range is
        // read as the word it is rather than as its first half.
        const from = doc.lineAt(view.viewport.from).from;
        const to = doc.lineAt(view.viewport.to).to;
        this.hits = findShortcodes(doc.sliceString(0, to), isIcon)
          .filter((hit) => hit.from >= from)
          .map((hit) => {
            const line = doc.lineAt(hit.from);
            return {
              ...hit,
              link: iconLinkAt(line.text, hit.from - line.from, hit.to - line.from)
            };
          });
        this.draw(view);
      }

      private draw(view: EditorView): void {
        const ranges = view.state.selection.ranges;
        const builder = new RangeSetBuilder<Decoration>();
        for (const hit of this.hits) {
          // A cursor inside or at either edge of the shortcode is editing it.
          const touched = ranges.some((range) => range.from <= hit.to && range.to >= hit.from);
          if (touched) continue;
          builder.add(
            hit.from,
            hit.to,
            Decoration.replace({ widget: new IconWidget(hit.name, hit.link, open) })
          );
        }
        this.decorations = builder.finish();
      }
    },
    { decorations: (value) => value.decorations }
  );
}

/** Elements whose text is never prose, however it reads. */
const NOT_PROSE = "code, pre, .math, .frontmatter, .cm-inline-code";

/** Whether a text node is the address a link shows, which is not prose. */
function inAddress(text: Text): boolean {
  const link = text.parentElement?.closest("a");
  return link ? !isLinkLabel(link.textContent, link.getAttribute("href")) : false;
}

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
      if (text.parentElement?.closest(NOT_PROSE) || inAddress(text)) continue;
      if (text.data.includes(":")) nodes.push(text);
    }
    if (nodes.length === 0) return;

    installIconFont(doc);
    for (const node of nodes) drawInto(node, doc);
  });
}

function drawInto(node: Text, doc: Document): void {
  const parent = node.parentNode;
  if (!parent) return;
  const pieces = withIcons(node.data, doc);
  if (pieces) parent.replaceChild(pieces, node);
}

/** The text as words and glyph spans, or null when it names no icon. */
function withIcons(text: string, doc: Document): DocumentFragment | null {
  const hits = findShortcodes(text, isIcon);
  if (hits.length === 0) return null;

  const pieces = doc.createDocumentFragment();
  let at = 0;
  for (const hit of hits) {
    if (hit.from > at) pieces.appendChild(doc.createTextNode(text.slice(at, hit.from)));
    const span = doc.createElement("span");
    span.className = "schreibstube-icon-shortcode";
    span.title = `:${hit.name}:`;
    applyIcon(span, hit.name);
    pieces.appendChild(span);
    at = hit.to;
  }
  if (at < text.length) pieces.appendChild(doc.createTextNode(text.slice(at)));
  return pieces;
}

/**
 * Set an element's text with its shortcodes drawn, for text the plugin draws
 * itself rather than Obsidian — a heading in the index block — which no
 * post-processor ever walks. Plain text when the setting is off.
 */
export function setTextWithIcons(el: HTMLElement, text: string, enabled: boolean): void {
  const pieces = enabled ? withIcons(text, el.doc) : null;
  if (!pieces) {
    el.setText(text);
    return;
  }
  installIconFont(el.doc);
  el.empty();
  el.appendChild(pieces);
}
