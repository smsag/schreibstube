/**
 * Calculation lines on screen: the result beside a line that ends in `=`, in
 * the editor and in Reading view, and Tab or a click to write it in.
 *
 * Which lines count and what they come to is decided in
 * `services/line-calculator`, by a rule shared with another app. This file draws it.
 * Nothing is written into a note until the writer accepts a result; the
 * note, mailed or printed, says what the writer wrote.
 */

import { Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate
} from "@codemirror/view";
import type { MarkdownPostProcessorContext, Plugin } from "obsidian";
import {
  acceptedLine,
  calculateLine,
  calculationLines,
  forEachProseLine,
  type CalculationContext
} from "../services/line-calculator";
import { isElementLike } from "../services/workspace-internals";
import { MAX_LIVE_CHARS } from "./live-limits";

const RESULT_CLASS = "schreibstube-calc-result";

/** The calculation context, or null while the setting is off. */
export type CalculationSource = () => CalculationContext | null;

/** A context's identity, so a change of format or rates draws the results again. */
function contextKey(ctx: CalculationContext | null): string {
  if (!ctx) return "";
  return `${ctx.format}|${ctx.conversion?.into ?? ""}|${ctx.conversion?.day ?? ""}`;
}

/**
 * Writes a line's result into it, the way the contract accepts: one space and
 * the result after the `=`, in place of whatever whitespace followed it.
 */
function accept(view: EditorView, lineNumber: number, ctx: CalculationContext): boolean {
  if (lineNumber > view.state.doc.lines) return false;
  const line = view.state.doc.line(lineNumber);
  const accepted = acceptedLine(line.text, ctx);
  if (accepted === null) return false;
  const kept = line.text.trimEnd().length;
  const end = line.from + accepted.length;
  view.dispatch({
    changes: { from: line.from + kept, to: line.to, insert: accepted.slice(kept) },
    selection: { anchor: end },
    userEvent: "input.complete"
  });
  return true;
}

class ResultWidget extends WidgetType {
  constructor(
    private readonly result: string,
    private readonly lineNumber: number,
    private readonly title: string,
    private readonly source: CalculationSource
  ) {
    super();
  }

  override eq(other: ResultWidget): boolean {
    return other.result === this.result && other.lineNumber === this.lineNumber;
  }

  override toDOM(view: EditorView): HTMLElement {
    const span = view.dom.doc.createElement("span");
    span.className = RESULT_CLASS;
    span.textContent = this.result;
    span.title = this.title;
    span.setAttribute("aria-label", this.title);
    // Kept from the editor, or the press would move the cursor to the line's
    // end before the click writes the result there.
    span.addEventListener("mousedown", (event) => event.preventDefault());
    span.addEventListener("click", (event) => {
      event.preventDefault();
      const ctx = this.source();
      if (ctx) accept(view, this.lineNumber, ctx);
    });
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** What the plugin found on screen, by line number, for Tab to look up. */
interface Found {
  results: Map<number, string>;
}

/**
 * The editor: results beside the lines on screen, and Tab at the end of one to
 * accept it. Lines are walked from the top so a fence that opened above the
 * screen is known, and evaluated only on screen; the cap on a note's length
 * keeps the walk the cost of a keystroke in prose.
 */
export function createCalculationExtension(
  source: CalculationSource,
  title: () => string
): Extension {
  const plugin = ViewPlugin.fromClass(
    class implements PluginValue, Found {
      decorations: DecorationSet = Decoration.none;
      results = new Map<number, string>();
      private key = "";

      constructor(view: EditorView) {
        this.scan(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || contextKey(source()) !== this.key) {
          this.scan(update.view);
        }
      }

      private scan(view: EditorView): void {
        const ctx = source();
        this.key = contextKey(ctx);
        this.results = new Map();
        const doc = view.state.doc;
        if (!ctx || doc.length > MAX_LIVE_CHARS || view.visibleRanges.length === 0) {
          this.decorations = Decoration.none;
          return;
        }
        const visible = view.visibleRanges.map((range) => ({
          from: doc.lineAt(range.from).number,
          to: doc.lineAt(range.to).number
        }));
        const last = visible[visible.length - 1]?.to ?? 1;
        const onScreen = (number: number): boolean =>
          visible.some((range) => number >= range.from && number <= range.to);

        const builder = new RangeSetBuilder<Decoration>();
        forEachProseLine(doc.sliceString(0, doc.line(last).to), (text, index) => {
          const number = index + 1;
          if (!onScreen(number)) return;
          const result = calculateLine(text, ctx);
          if (!result) return;
          this.results.set(number, result.text);
          builder.add(
            doc.line(number).to,
            doc.line(number).to,
            Decoration.widget({
              widget: new ResultWidget(result.text, number, title(), source),
              side: 1
            })
          );
        });
        this.decorations = builder.finish();
      }
    },
    { decorations: (value) => value.decorations }
  );

  const tab = Prec.highest(
    keymap.of([
      {
        key: "Tab",
        run: (view) => {
          const ctx = source();
          const found = view.plugin(plugin);
          const selection = view.state.selection;
          if (!ctx || !found || selection.ranges.length !== 1 || !selection.main.empty) {
            return false;
          }
          const line = view.state.doc.lineAt(selection.main.head);
          // At the end of the line, whitespace after the `=` aside: anywhere
          // else Tab indents, as it always did.
          if (selection.main.head < line.from + line.text.trimEnd().length) return false;
          if (!found.results.has(line.number)) return false;
          return accept(view, line.number, ctx);
        }
      }
    ])
  );

  return [plugin, tab];
}

/** Elements whose text is never a calculation line, however it reads. */
const NOT_PROSE = "pre, code, .math, table, .frontmatter, .callout-title";

/** One rendered line: where its text ends, and whether it ends in `=`. */
interface RenderedLine {
  after: Node;
  text: string;
}

/**
 * The lines of a rendered block, split where Obsidian put a line break. A
 * list item's own text only: a list inside it has lines of its own.
 */
function renderedLines(block: Element): RenderedLine[] {
  const lines: RenderedLine[] = [];
  let text = "";
  let last: Node | null = null;
  for (const node of Array.from(block.childNodes)) {
    if (node.nodeName === "BR") {
      if (last) lines.push({ after: last, text });
      text = "";
      last = null;
      continue;
    }
    if (isElementLike(node) && /^(UL|OL|P|DIV|BLOCKQUOTE)$/.test(node.nodeName)) continue;
    text += node.textContent ?? "";
    last = node;
  }
  if (last) lines.push({ after: last, text });
  return lines;
}

const endsLikeCalculation = (text: string): boolean => {
  const trimmed = text.trim();
  return trimmed.endsWith("=") && !trimmed.endsWith("==");
};

/**
 * Reading view: the results of a rendered section, beside the lines they
 * belong to.
 *
 * The rendered text is not the source — `2*3*4 =` renders as emphasis — so a
 * result is matched to its line by order, not by text: the section's source
 * lines that end in `=` and its rendered lines that do. When the two do not
 * line up one to one (strict line breaks fold lines together, say), nothing
 * is drawn rather than a result beside the wrong line.
 */
export function drawSectionResults(
  el: HTMLElement,
  source: string,
  lineStart: number,
  lineEnd: number,
  ctx: CalculationContext,
  results: ReadonlyMap<number, string> = new Map(
    calculationLines(source, ctx).map(({ line, result }) => [line, result])
  )
): void {
  const wanted: (string | null)[] = [];
  forEachProseLine(source, (text, index) => {
    if (index < lineStart || index > lineEnd || !endsLikeCalculation(text)) return;
    wanted.push(results.get(index) ?? null);
  });
  if (!wanted.some((result) => result !== null)) return;

  const rendered: RenderedLine[] = [];
  for (const block of Array.from(el.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6"))) {
    if (block.closest(NOT_PROSE)) continue;
    for (const line of renderedLines(block)) {
      if (endsLikeCalculation(line.text)) rendered.push(line);
    }
  }
  if (rendered.length !== wanted.length) return;

  rendered.forEach((line, index) => {
    const result = wanted[index];
    const parent = line.after.parentNode;
    if (!result || !parent) return;
    const span = el.doc.createElement("span");
    span.className = RESULT_CLASS;
    span.textContent = result;
    parent.insertBefore(span, line.after.nextSibling);
  });
}

/**
 * Reading view's post-processor. Every section of a note asks for the whole
 * note's results, so they are worked out once per note text and context.
 */
export function registerCalculationPostProcessor(plugin: Plugin, source: CalculationSource): void {
  let cached: { text: string; key: string; results: Map<number, string> } | null = null;
  plugin.registerMarkdownPostProcessor((el: HTMLElement, mdCtx: MarkdownPostProcessorContext) => {
    const ctx = source();
    if (!ctx) return;
    const info = mdCtx.getSectionInfo(el);
    if (!info || info.text.length > MAX_LIVE_CHARS) return;
    const key = contextKey(ctx);
    if (!cached || cached.text !== info.text || cached.key !== key) {
      const results = new Map(
        calculationLines(info.text, ctx).map(({ line, result }) => [line, result])
      );
      cached = { text: info.text, key, results };
    }
    drawSectionResults(el, info.text, info.lineStart, info.lineEnd, ctx, cached.results);
  });
}
