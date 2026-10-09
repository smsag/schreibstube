/**
 * What a note's row shows at its right edge: its task count, its due day, or
 * — when it has both — the two in one pill.
 *
 * Two pills side by side cost a name a third of a phone-width row: each has
 * its own padding, the row's gap sits between them, and the name is what the
 * row is for. So a row with both draws one pill, a size smaller, the count and
 * the day inside it separated by a dot. A row with one mark keeps the pill it
 * always had. Either way the name has a floor — see `.schreibstube-explorer-name`
 * in styles.css — and it is the marks that give way, never the name.
 */
import { t } from "../i18n";
import type { DueLabel } from "../services/due-date";
import { taskCount, type TaskTally } from "../services/task-count";
import { drawDueDate, DUE_SLOT_CLASS } from "./due-date-label";
import { drawTaskCount, TASK_PILL_CLASS } from "./task-count-label";

/** The combined pill's own class, where its size and its shrinking live. */
export const MARKS_CLASS = "schreibstube-explorer-marks";

export function drawRowMarks(
  row: HTMLElement,
  tally: TaskTally | null,
  due: DueLabel | null
): void {
  const count = tally ? taskCount(tally) : null;
  if (!count || !due) {
    if (tally) drawTaskCount(row, tally, "schreibstube-explorer-tasks");
    drawDueDate(row, due);
    return;
  }

  // Both: one pill. It wears the due slot's class as well, so the day's state
  // colours it the way a lone date is coloured, and the pill's class, so the
  // look is the one rule set.
  const el = row.createSpan({ cls: `${MARKS_CLASS} ${DUE_SLOT_CLASS} ${TASK_PILL_CLASS}` });
  el.dataset.state = due.state;
  if (count.complete) el.dataset.tasks = "done";
  el.createSpan({ cls: `${TASK_PILL_CLASS}-done`, text: String(count.done) });
  el.createSpan({ cls: `${TASK_PILL_CLASS}-total`, text: `/${count.total}` });
  el.createSpan({ cls: `${MARKS_CLASS}-sep`, text: "·" });
  el.createSpan({ cls: `${MARKS_CLASS}-due`, text: due.text });
  el.setAttribute(
    "aria-label",
    `${t().explorer.taskCount(count.done, count.total, count.progress)}, ${t().explorer.dueDate(due.long, due.state)}`
  );
}
