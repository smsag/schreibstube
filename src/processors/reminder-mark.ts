import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from "@codemirror/view";
import { t } from "../i18n";
import { isTaskLine, reminderLinkSpan } from "../services/reminder-export";
import { renderReminderIcon } from "../ui/reminder-icon";

export const REMINDER_MARK_CLASS = "schreibstube-reminder-mark";

/**
 * Draws the reminder link at the end of a sent task as a small Reminders mark
 * in Live Preview.
 *
 * The link stays in the text; only its rendering changes, and only while the
 * cursor is elsewhere, the way Obsidian itself shows a link's source when it
 * is being edited. Source mode is left alone: there the text is the point.
 */
export function createReminderMarkExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildMarks(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildMarks(update.view);
        }
      }
    },
    { decorations: (value) => value.decorations }
  );
}

class ReminderMarkWidget extends WidgetType {
  constructor(private readonly id: string) {
    super();
  }

  override eq(other: ReminderMarkWidget): boolean {
    return other.id === this.id;
  }

  override toDOM(view: EditorView): HTMLElement {
    const mark = view.dom.ownerDocument.createElement("span");
    mark.className = REMINDER_MARK_CLASS;
    mark.setAttribute("aria-label", t().tasks.markTooltip);
    renderReminderIcon(mark);
    return mark;
  }
}

function buildMarks(view: EditorView): DecorationSet {
  if (!view.dom.closest(".is-live-preview")) return Decoration.none;

  const { doc, selection } = view.state;
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;

      const span = reminderLinkSpan(line.text);
      if (!span || !isTaskLine(line.text)) continue;
      const edited = selection.ranges.some(
        (range) => range.from <= line.to && range.to >= line.from
      );
      if (edited) continue;

      builder.add(
        line.from + span.from,
        line.from + span.to,
        Decoration.replace({ widget: new ReminderMarkWidget(span.id) })
      );
    }
  }

  return builder.finish();
}
