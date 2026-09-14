import {
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  Decoration
} from "@codemirror/view";
import { type EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import { t } from "../i18n";
import { hasTaskSummaryBlock, summarizeTasks } from "../services/task-summary";

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

      constructor(view: EditorView) {
        this.decorations = buildTaskBadges(view.state);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) this.decorations = buildTaskBadges(update.state);
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

function buildTaskBadges(state: EditorState): DecorationSet {
  const content = state.doc.toString();
  if (!hasTaskSummaryBlock(content)) return Decoration.none;

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
