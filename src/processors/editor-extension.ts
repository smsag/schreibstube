import {
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  Decoration
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { resolveFocusRange, type FocusRange } from "../services/focus-range";
import { topEdgeLines } from "../services/editor-top-edge";
import {
  FALLBACK_OVERLAY_METRICS,
  measureOverlayMetrics,
  overlayHeightsByDepth,
  type OverlayMetrics
} from "../services/overlay-geometry";
import { isCommentLine } from "../services/comment-line";
import type { SchreibstubeSettings } from "../types";

export interface EditorViewportUpdate {
  /** The zero-based line under the overlay at each depth it could take, from empty up. */
  edgeLines: number[];
  /** The editor that scrolled: every open editor reports, and only the active note's counts. */
  editorDom: HTMLElement;
}

const FOCUS_SETTINGS_CHANGED = "schreibstube-focus-settings-changed";

interface EditorExtensionOptions {
  onViewportUpdate: (update: EditorViewportUpdate) => void;
  getSettings: () => SchreibstubeSettings;
}

export function createEditorExtension(options: EditorExtensionOptions): Extension {
  return [createFocusExtension(options), createCommentDimExtension(options.getSettings)];
}

const COMMENT_LINE = Decoration.line({ class: "schreibstube-comment-line" });

/**
 * Lines that open with `//` are the writer's asides, and fade by the focus
 * mode's dim strength whether focus mode is on or not.
 *
 * The strength goes on the editor as its own variable, because focus mode
 * takes its variable down again whenever it switches off.
 */
function createCommentDimExtension(getSettings: () => SchreibstubeSettings): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(private view: EditorView) {
        this.decorations = this.build();
        this.applyOpacity();
        window.addEventListener(FOCUS_SETTINGS_CHANGED, this.applyOpacity);
      }

      update(update: ViewUpdate): void {
        this.view = update.view;
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build();
        }
      }

      destroy(): void {
        window.removeEventListener(FOCUS_SETTINGS_CHANGED, this.applyOpacity);
        this.view.dom.style.removeProperty("--schreibstube-comment-dim-opacity");
      }

      private applyOpacity = (): void => {
        this.view.dom.style.setProperty(
          "--schreibstube-comment-dim-opacity",
          String(getSettings().focusDimOpacity)
        );
      };

      private build(): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = this.view.state.doc;
        for (const range of this.view.visibleRanges) {
          const lastLine = doc.lineAt(range.to).number;
          for (let n = doc.lineAt(range.from).number; n <= lastLine; n += 1) {
            const line = doc.line(n);
            if (isCommentLine(line.text)) builder.add(line.from, line.from, COMMENT_LINE);
          }
        }
        return builder.finish();
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

function createFocusExtension(options: EditorExtensionOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      private view: EditorView;
      decorations: DecorationSet = Decoration.none;
      private measurePending = false;
      private lastEdgeLines = "";
      private lastFocusSignature = "";
      /** Whether the editor wears the mode's classes and variable right now. */
      private dressed = false;
      private onViewportUpdate: (update: EditorViewportUpdate) => void;
      private getSettings: () => SchreibstubeSettings;

      constructor(view: EditorView) {
        this.view = view;
        this.onViewportUpdate = options.onViewportUpdate;
        this.getSettings = options.getSettings;
        this.view.scrollDOM.addEventListener("scroll", this.handleScroll, { passive: true });
        window.addEventListener(FOCUS_SETTINGS_CHANGED, this.handleFocusSettingsChanged);
        this.syncFocus(this.getSettings(), true);
        this.queueViewportUpdate(true);
      }

      update(update: ViewUpdate): void {
        this.view = update.view;
        // The decorations cover only the visible range, so a scroll has to
        // decorate the lines it revealed, and an edit moves every position
        // under them, whether or not the focused range read the same.
        this.syncFocus(this.getSettings(), update.docChanged || update.viewportChanged);

        if (!update.viewportChanged && !update.docChanged) {
          return;
        }

        this.queueViewportUpdate(update.docChanged);
      }

      destroy(): void {
        this.view.scrollDOM.removeEventListener("scroll", this.handleScroll);
        window.removeEventListener(FOCUS_SETTINGS_CHANGED, this.handleFocusSettingsChanged);
        this.undress();
      }

      private handleScroll = (): void => {
        this.queueViewportUpdate(false);
      };

      private handleFocusSettingsChanged = (): void => {
        this.view.dispatch({ annotations: [] });
      };

      /**
       * Bring the decorations in line with the mode and the cursor.
       *
       * With the mode off — or the editor not the one being typed in — the
       * classes come down once and every transaction after that costs
       * nothing. On, the work is done only when what would be drawn has
       * changed: the range the cursor resolves to rather than the cursor
       * itself, so moving within a sentence or a paragraph draws nothing new.
       */
      private syncFocus(settings: SchreibstubeSettings, force: boolean): void {
        if (settings.focusMode === "off" || !this.view.hasFocus) {
          this.undress();
          return;
        }

        const focusRange = this.resolveFocus(settings);
        const signature =
          `${settings.focusMode}:${settings.focusDimOpacity}:` +
          `${focusRange?.startLine}-${focusRange?.endLine}:${focusRange?.startCh}-${focusRange?.endCh}`;
        if (!force && signature === this.lastFocusSignature) return;
        this.rebuildFocusDecorations(settings, focusRange, signature);
      }

      private undress(): void {
        if (!this.dressed) return;
        this.dressed = false;
        this.lastFocusSignature = "";
        this.decorations = Decoration.none;
        this.view.dom.classList.remove("schreibstube-focus-enabled");
        this.view.dom.classList.remove("schreibstube-focus-mode-sentence");
        this.view.dom.classList.remove("schreibstube-focus-mode-paragraph");
        this.view.dom.style.removeProperty("--schreibstube-focus-dim-opacity");
      }

      private resolveFocus(settings: SchreibstubeSettings): FocusRange | null {
        const doc = this.view.state.doc;
        const cursorPos = this.view.state.selection.main.head;
        const cursorLine = doc.lineAt(cursorPos);
        return resolveFocusRange(
          { lines: doc.lines, line: (lineNumber: number) => doc.line(lineNumber) },
          cursorLine.number - 1,
          settings.focusMode,
          cursorPos - cursorLine.from
        );
      }

      private rebuildFocusDecorations(
        settings: SchreibstubeSettings,
        focusRange: FocusRange | null,
        signature: string
      ): void {
        this.lastFocusSignature = signature;
        this.dressed = true;
        this.view.dom.style.setProperty(
          "--schreibstube-focus-dim-opacity",
          String(settings.focusDimOpacity)
        );
        this.view.dom.classList.add("schreibstube-focus-enabled");
        this.view.dom.classList.toggle(
          "schreibstube-focus-mode-sentence",
          settings.focusMode === "sentence"
        );
        this.view.dom.classList.toggle(
          "schreibstube-focus-mode-paragraph",
          settings.focusMode !== "sentence"
        );

        if (!focusRange) {
          this.decorations = Decoration.none;
          return;
        }

        const builder = new RangeSetBuilder<Decoration>();
        const doc = this.view.state.doc;
        const sentence =
          settings.focusMode === "sentence" &&
          focusRange.startCh !== undefined &&
          focusRange.endCh !== undefined;

        for (const range of this.view.visibleRanges) {
          const firstLine = doc.lineAt(range.from).number;
          const lastLine = doc.lineAt(range.to).number;

          for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
            const line = doc.line(lineNumber);
            const inFocusRange = sentence
              ? false
              : lineNumber >= focusRange.startLine && lineNumber <= focusRange.endLine;
            const className = inFocusRange
              ? "schreibstube-focus-active"
              : "schreibstube-focus-dimmed";
            builder.add(line.from, line.from, Decoration.line({ class: className }));

            if (sentence && lineNumber === focusRange.startLine) {
              builder.add(
                line.from + (focusRange.startCh ?? 0),
                line.from + (focusRange.endCh ?? 0),
                Decoration.mark({ class: "schreibstube-focus-sentence" })
              );
            }
          }
        }

        this.decorations = builder.finish();
      }

      private queueViewportUpdate(force: boolean): void {
        if (this.measurePending) {
          return;
        }

        this.measurePending = true;
        this.view.requestMeasure({
          read: () => resolveEdgeLines(this.view),
          write: (edgeLines) => {
            this.measurePending = false;

            const signature = edgeLines.join(",");
            if (!force && signature === this.lastEdgeLines) {
              return;
            }

            this.lastEdgeLines = signature;
            this.onViewportUpdate({ edgeLines, editorDom: this.view.dom });
          }
        });
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

/** The overlay as last drawn, kept for the frames in which it shows no rows to measure. */
let overlayMetrics: OverlayMetrics = FALLBACK_OVERLAY_METRICS;

function resolveEdgeLines(view: EditorView): number[] {
  // This editor's own overlay: it sits beside the editor in the note's source
  // view, never inside the scroller, and asking the whole document found the
  // first overlay anywhere — another pane's, or none at all.
  const overlay = view.dom
    .closest(".markdown-source-view")
    ?.querySelector<HTMLElement>(":scope > .schreibstube-overlay");
  const list = overlay?.querySelector<HTMLElement>(".schreibstube-overlay-list");
  if (overlay && list) {
    const measured = measureOverlayMetrics({
      overlayHeight: overlay.offsetHeight,
      listHeight: list.offsetHeight,
      rows: list.childElementCount,
      gap: Number.parseFloat(getComputedStyle(list).rowGap) || 0
    });
    if (measured) overlayMetrics = measured;
  }
  return topEdgeLines(view, overlayHeightsByDepth(overlayMetrics));
}
