/**
 * Optional live underline for glossary terms in the editor.
 *
 * Off by default, and limited to error-severity hits when on, because a note
 * full of underlines trains people to ignore them. It reuses the same segmenter
 * and matcher as the sidebar scan, so a term underlined here is exactly a term
 * the review queue would raise, never a second opinion.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import type { GlossaryMatcher } from "../services/glossary-matcher";
import { segmentMarkdown } from "../services/markdown-segments";
import type { SchreibstubeSettings } from "../types";
import { GLOSSARY_CHANGED_EVENT } from "../utils/constants";

/** Re-scanning on every keystroke is wasteful on a long note; a short idle
 *  delay keeps typing smooth without a visible lag on the underline. */
const RESCAN_DELAY_MS = 400;

/** Above this size the whole-document scan is skipped. The sidebar still checks
 *  the note on demand; only the always-on underline steps aside. */
const MAX_LIVE_CHARS = 200_000;

interface GlossaryUnderlineOptions {
  getSettings: () => SchreibstubeSettings;
  getMatcher: () => GlossaryMatcher;
}

const UNDERLINE = Decoration.mark({ class: "schreibstube-glossary-hit" });

export function createGlossaryUnderlineExtension(options: GlossaryUnderlineOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private timer = 0;

      constructor(private view: EditorView) {
        window.addEventListener(GLOSSARY_CHANGED_EVENT, this.handleGlossaryChanged);
        this.rebuild();
      }

      update(update: ViewUpdate): void {
        this.view = update.view;
        if (update.docChanged) {
          this.schedule();
        }
      }

      destroy(): void {
        window.clearTimeout(this.timer);
        window.removeEventListener(GLOSSARY_CHANGED_EVENT, this.handleGlossaryChanged);
      }

      private handleGlossaryChanged = (): void => {
        this.rebuild();
        // A rebuild outside a transaction needs an explicit nudge for the new
        // decorations to reach the DOM.
        this.view.dispatch({});
      };

      private schedule(): void {
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.rebuild();
          this.view.dispatch({});
        }, RESCAN_DELAY_MS);
      }

      private rebuild(): void {
        const settings = options.getSettings();
        const matcher = options.getMatcher();
        const text = this.view.state.doc.toString();

        if (!settings.glossaryLiveUnderline || matcher.isEmpty() || text.length > MAX_LIVE_CHARS) {
          this.decorations = Decoration.none;
          return;
        }

        const builder = new RangeSetBuilder<Decoration>();
        for (const block of segmentMarkdown(text).blocks) {
          for (const hit of matcher.findHits(block.text, block.protectedRanges)) {
            if (hit.severity !== "error") continue;
            builder.add(block.from + hit.from, block.from + hit.to, UNDERLINE);
          }
        }
        this.decorations = builder.finish();
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}
