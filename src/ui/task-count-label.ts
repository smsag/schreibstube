/**
 * The task tally as it appears beside a note's name: done over total.
 *
 * Two spans rather than one, because the two numbers are not equally useful.
 * The leading one is what a person is scanning for, so it carries the row's
 * own weight and colour; the total is context and stays muted. A note with
 * nothing left open steps back entirely, which is what makes the rows that
 * still want work the only ones with weight in the column.
 *
 * One renderer for both surfaces that show it — the file pane's rows and the
 * pinned-tag cards — because they read the same tally and must not come to
 * disagree about what it says. Only the class base differs; each surface
 * keeps its own size and spacing.
 */
import { t } from "../i18n";
import { taskCount, type TaskTally } from "../services/task-count";

export function drawTaskCount(parent: HTMLElement, tally: TaskTally, base: string): void {
  const count = taskCount(tally);
  if (count === null) return;

  const el = parent.createSpan({ cls: base });
  // The state lives on the element that shows it, so one rule per surface
  // dims it and nothing has to look up at an ancestor to know.
  if (count.complete) el.dataset.state = "done";
  el.createSpan({ cls: `${base}-done`, text: String(count.done) });
  el.createSpan({ cls: `${base}-total`, text: `/${count.total}` });
  el.setAttribute("aria-label", t().explorer.taskCount(count.done, count.total));
}
