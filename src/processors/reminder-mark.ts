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
import { reminderIdSpan } from "../services/reminder-tasks";
import type { SchreibstubeSettings } from "../types";
import { renderReminderIcon } from "../ui/reminder-icon";

export const REMINDER_MARK_CLASS = "schreibstube-reminder-mark";

/**
 * Draws the block id at the end of a synced task as a small Reminders mark
 * in Live Preview.
 *
 * The id stays in the text; only its rendering changes, and only while the
 * cursor is elsewhere, the way Obsidian itself shows a link's source when it
 * is being edited. Source mode is left alone: there the text is the point.
 * With the sync off, an id is just an id and is drawn as one.
 */
export function createReminderMarkExtension(getSettings: () => SchreibstubeSettings): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildMarks(view, getSettings());
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildMarks(update.view, getSettings());
        }
      }
    },
    { decorations: (value) => value.decorations }
  );
}

class ReminderMarkWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(view: EditorView): HTMLElement {
    const mark = view.dom.ownerDocument.createElement("span");
    mark.className = REMINDER_MARK_CLASS;
    mark.setAttribute("aria-label", t().tasks.markTooltip);
    renderReminderIcon(mark);
    return mark;
  }
}

function buildMarks(view: EditorView, settings: SchreibstubeSettings): DecorationSet {
  if (!settings.remindersEnabled || !view.dom.closest(".is-live-preview")) return Decoration.none;

  const { doc, selection } = view.state;
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;

      const span = reminderIdSpan(line.text, settings.remindersTrigger);
      if (!span) continue;
      const edited = selection.ranges.some(
        (range) => range.from <= line.to && range.to >= line.from
      );
      if (edited) continue;

      builder.add(
        line.from + span.from,
        line.from + span.to,
        Decoration.replace({ widget: new ReminderMarkWidget() })
      );
    }
  }

  return builder.finish();
}
