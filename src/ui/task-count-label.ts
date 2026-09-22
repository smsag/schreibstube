/**
 * The task tally as it appears beside a note's name: done over total.
 *
 * Two spans rather than one, because the two numbers are not equally useful.
 * The leading one is what a person is scanning for, so it carries the row's
 * colour; the total is context and stays muted. A note with nothing left open
 * steps back entirely, which is what makes the rows that still want work the
 * only ones carrying colour in the column.
 *
 * One renderer for both surfaces that show it — the file pane's rows and the
 * pinned-tag cards — because they read the same tally and must not come to
 * disagree about what it says. Every element also wears the shared
 * `schreibstube-tasks` class, which is where the pill's whole look lives; the
 * surface's own base class carries nothing but its size and alignment. The
 * two surfaces used to hold a copy of the look each, and they drifted.
 */
import { t } from "../i18n";
import { taskCount, type TaskTally } from "../services/task-count";

/** Where the pill's look lives — see styles.css. Exported so the stylesheet
 *  guard and this renderer cannot be renamed apart. */
export const TASK_PILL_CLASS = "schreibstube-tasks";

export function drawTaskCount(parent: HTMLElement, tally: TaskTally, base: string): void {
  const count = taskCount(tally);
  if (count === null) return;

  const el = parent.createSpan({ cls: `${base} ${TASK_PILL_CLASS}` });
  // The state lives on the element that shows it, so one rule dims it and
  // nothing has to look up at an ancestor to know.
  if (count.complete) el.dataset.state = "done";
  el.createSpan({ cls: `${TASK_PILL_CLASS}-done`, text: String(count.done) });
  el.createSpan({ cls: `${TASK_PILL_CLASS}-total`, text: `/${count.total}` });
  el.setAttribute("aria-label", t().explorer.taskCount(count.done, count.total));
}
