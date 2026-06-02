import {
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  Decoration
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { resolveFocusRange } from "../services/focus-range";
import type { SchreibstubeSettings } from "../types";

export interface EditorViewportUpdate {
  viewportTopLine: number;
}

const FOCUS_SETTINGS_CHANGED = "schreibstube-focus-settings-changed";

interface EditorExtensionOptions {
  onViewportUpdate: (update: EditorViewportUpdate) => void;
  getSettings: () => SchreibstubeSettings;
}

export function createEditorExtension(
  options: EditorExtensionOptions
): Extension {
  return ViewPlugin.fromClass(
    class {
      private view: EditorView;
      decorations: DecorationSet = Decoration.none;
      private measurePending = false;
      private lastViewportTopLine = -1;
      private lastFocusSignature = "";
      private onViewportUpdate: (update: EditorViewportUpdate) => void;
      private getSettings: () => SchreibstubeSettings;

      constructor(view: EditorView) {
        this.view = view;
        this.onViewportUpdate = options.onViewportUpdate;
        this.getSettings = options.getSettings;
        this.view.scrollDOM.addEventListener("scroll", this.handleScroll, { passive: true });
        window.addEventListener(FOCUS_SETTINGS_CHANGED, this.handleFocusSettingsChanged);
        this.rebuildFocusDecorations();
        this.queueViewportUpdate(true);
      }

      update(update: ViewUpdate): void {
        this.view = update.view;

        const settings = this.getSettings();
        const focusSignature = this.computeFocusSignature(settings);
        const didFocusChange = focusSignature !== this.lastFocusSignature;

        if (
          update.docChanged ||
          update.selectionSet ||
          update.focusChanged ||
          didFocusChange
        ) {
          this.rebuildFocusDecorations(settings, focusSignature);
        }

        if (!update.viewportChanged && !update.docChanged) {
          return;
        }

        this.queueViewportUpdate(update.docChanged);
      }

      destroy(): void {
        this.view.scrollDOM.removeEventListener("scroll", this.handleScroll);
        window.removeEventListener(FOCUS_SETTINGS_CHANGED, this.handleFocusSettingsChanged);
        this.view.dom.classList.remove("schreibstube-focus-enabled");
        this.view.dom.classList.remove("schreibstube-focus-mode-sentence");
        this.view.dom.classList.remove("schreibstube-focus-mode-paragraph");
        this.view.dom.style.removeProperty("--schreibstube-focus-dim-opacity");
      }

      private handleScroll = (): void => {
        this.queueViewportUpdate(false);
      };

      private handleFocusSettingsChanged = (): void => {
        this.view.dispatch({ annotations: [] });
      };

      private rebuildFocusDecorations(
        settings: SchreibstubeSettings = this.getSettings(),
        focusSignature: string = this.computeFocusSignature(settings)
      ): void {
        this.lastFocusSignature = focusSignature;
        this.view.dom.style.setProperty(
          "--schreibstube-focus-dim-opacity",
          String(settings.focusDimOpacity)
        );

        this.view.dom.classList.remove("schreibstube-focus-mode-sentence");
        this.view.dom.classList.remove("schreibstube-focus-mode-paragraph");

        if (settings.focusMode === "off" || !this.view.hasFocus) {
          this.view.dom.classList.remove("schreibstube-focus-enabled");
          this.decorations = Decoration.none;
          return;
        }

        this.view.dom.classList.add("schreibstube-focus-enabled");
        this.view.dom.classList.add(
          settings.focusMode === "sentence"
            ? "schreibstube-focus-mode-sentence"
            : "schreibstube-focus-mode-paragraph"
        );

        const cursorPos = this.view.state.selection.main.head;
        const cursorLine = this.view.state.doc.lineAt(cursorPos).number - 1;
        const focusRange = resolveFocusRange(
          {
            lines: this.view.state.doc.lines,
            line: (lineNumber: number) => this.view.state.doc.line(lineNumber)
          },
          cursorLine,
          settings.focusMode,
          cursorPos - this.view.state.doc.lineAt(cursorPos).from
        );

        if (!focusRange) {
          this.decorations = Decoration.none;
          return;
        }

        const builder = new RangeSetBuilder<Decoration>();
        const totalLines = this.view.state.doc.lines;

        for (let lineNumber = 1; lineNumber <= totalLines; lineNumber += 1) {
          const line = this.view.state.doc.line(lineNumber);
          const inFocusRange =
            settings.focusMode === "sentence" &&
            focusRange.startCh !== undefined &&
            focusRange.endCh !== undefined
              ? false
              : lineNumber >= focusRange.startLine && lineNumber <= focusRange.endLine;
          const className = inFocusRange
            ? "schreibstube-focus-active"
            : "schreibstube-focus-dimmed";
          builder.add(line.from, line.from, Decoration.line({ class: className }));

          if (
            settings.focusMode === "sentence" &&
            focusRange.startCh !== undefined &&
            focusRange.endCh !== undefined &&
            lineNumber === focusRange.startLine
          ) {
            builder.add(
              line.from + focusRange.startCh,
              line.from + focusRange.endCh,
              Decoration.mark({ class: "schreibstube-focus-sentence" })
            );
          }
        }

        this.decorations = builder.finish();
      }

      private computeFocusSignature(settings: SchreibstubeSettings): string {
        const selectionHead = this.view.state.selection.main.head;
        return `${settings.focusMode}:${settings.focusDimOpacity}:${selectionHead}:${this.view.state.doc.length}:${this.view.hasFocus}`;
      }

      private queueViewportUpdate(force: boolean): void {
        if (this.measurePending) {
          return;
        }

        this.measurePending = true;
        this.view.requestMeasure({
          read: () => resolveTopEdgeLine(this.view),
          write: (viewportTopLine) => {
            this.measurePending = false;

            if (!force && viewportTopLine === this.lastViewportTopLine) {
              return;
            }

            this.lastViewportTopLine = viewportTopLine;
            this.onViewportUpdate({ viewportTopLine });
          }
        });
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

function resolveTopEdgeLine(view: EditorView): number {
  const scrollerRect = view.scrollDOM.getBoundingClientRect();
  const overlay =
    (view.scrollDOM.querySelector(".schreibstube-overlay") as HTMLElement | null) ??
    (view.dom.ownerDocument.querySelector(".schreibstube-overlay") as HTMLElement | null);
  const overlayHeight = overlay?.offsetHeight ?? 0;
  const topEdgePos = view.posAtCoords({
    x: scrollerRect.left + 1,
    y: scrollerRect.top + overlayHeight + 1
  });

  if (topEdgePos !== null) {
    return Math.max(0, view.state.doc.lineAt(topEdgePos).number - 1);
  }

  return Math.max(0, view.state.doc.lineAt(view.viewport.from).number - 1);
}
