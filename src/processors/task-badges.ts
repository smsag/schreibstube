import {
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  Decoration
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  type Text,
  type Transaction
} from "@codemirror/state";
import { t } from "../i18n";
import { fenceMarker } from "../services/markdown-fence";
import { hasTaskSummaryBlock, summarizeTasks } from "../services/task-summary";
import { MAX_LIVE_CHARS } from "./live-limits";

export const TASK_BADGE_ATTRIBUTE = "data-schreibstube-tasks";

/**
 * An "N of M open" badge after every heading that owns tasks, while the note
 * carries a ribbon block.
 *
 * The badge is a line decoration carrying a data attribute that the stylesheet
 * turns into an `::after` pseudo-element. A widget at the end of the line would
 * be swallowed by a heading fold, which replaces everything from the line's end
 * onwards; a line attribute is not, and the count stays on the folded heading,
 * where it is most wanted.
 */
export function createTaskBadgeExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** Whether the note carries the block at all, which most notes do not. */
      private active: boolean;

      constructor(view: EditorView) {
        this.active = hasBlock(view.state);
        this.decorations = this.active ? buildTaskBadges(view.state) : Decoration.none;
      }

      update(update: ViewUpdate): void {
        if (!update.docChanged) return;
        // Whether there is a block is asked again only when an edit touched a
        // fence line: reading the whole note for the answer on every
        // keystroke was the one cost every note paid for a feature few use.
        if (update.transactions.some(touchesFence)) this.active = hasBlock(update.state);
        this.decorations = this.active ? buildTaskBadges(update.state) : Decoration.none;
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

function hasBlock(state: EditorState): boolean {
  return state.doc.length <= MAX_LIVE_CHARS && hasTaskSummaryBlock(state.doc.toString());
}

/** Whether a changed range lies on a fence line, before or after the change. */
function touchesFence(tr: Transaction): boolean {
  let touched = false;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (touched) return;
    touched = hasFenceLine(tr.startState.doc, fromA, toA) || hasFenceLine(tr.state.doc, fromB, toB);
  });
  return touched;
}

function hasFenceLine(doc: Text, from: number, to: number): boolean {
  const last = doc.lineAt(to).number;
  for (let number = doc.lineAt(from).number; number <= last; number += 1) {
    if (fenceMarker(doc.line(number).text) !== null) return true;
  }
  return false;
}

function buildTaskBadges(state: EditorState): DecorationSet {
  if (state.doc.length > MAX_LIVE_CHARS) return Decoration.none;
  const content = state.doc.toString();

  const builder = new RangeSetBuilder<Decoration>();
  for (const section of summarizeTasks(content).sections) {
    if (section.total === 0) continue;
    const line = state.doc.line(section.headingLine + 1);
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: "schreibstube-task-heading",
        attributes: { [TASK_BADGE_ATTRIBUTE]: t().tasks.badge(section.open, section.total) }
      })
    );
  }
  return builder.finish();
}
