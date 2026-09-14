import { type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, Decoration } from "@codemirror/view";
import { type EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import { formatSectionBadge, hasTaskSummaryBlock, summarizeTasks } from "../services/task-summary";

export const TASK_BADGE_ATTRIBUTE = "data-schreibstube-tasks";

/**
 * Paints an "N of M open" badge after every heading that owns tasks, but only
 * while the document contains a task summary ribbon block.
 *
 * The badge is a line decoration carrying a data attribute that CSS turns into
 * an `::after` pseudo-element. Unlike a widget at the end of the line, a line
 * attribute is untouched by heading folds, so the badge stays visible when the
 * heading is collapsed.
 */
export function createTaskBadgeExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildTaskBadges(view.state);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.decorations = buildTaskBadges(update.state);
        }
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

function buildTaskBadges(state: EditorState): DecorationSet {
  const content = state.doc.toString();
  if (!hasTaskSummaryBlock(content)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (const section of summarizeTasks(content).sections) {
    if (section.total === 0) continue;
    const line = state.doc.line(section.headingLine + 1);
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: "schreibstube-task-heading",
        attributes: { [TASK_BADGE_ATTRIBUTE]: formatSectionBadge(section) }
      })
    );
  }
  return builder.finish();
}
