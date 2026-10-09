/**
 * The due day as it appears at a row's right edge.
 *
 * It wears the task pill's class, so the padding, the corner and the accent
 * wash the stylesheet measured for the tally are the same rule here, not a
 * copy that drifts from it. Its state says which of those it keeps: a day
 * still ahead drops the fill, today keeps it, and a missed day adds an outline
 * — a shape, so the three read apart without telling one colour from another.
 *
 * Only a row with a day draws anything. A fixed-width slot on every row, there
 * to line the days up in a column, changed the box of every row in the pane
 * for a column most vaults never fill; a date is rare, and sits where the
 * task count does.
 */
import { t } from "../i18n";
import type { DueLabel } from "../services/due-date";
import { TASK_PILL_CLASS } from "./task-count-label";

export const DUE_SLOT_CLASS = "schreibstube-explorer-due";

export function drawDueDate(parent: HTMLElement, label: DueLabel | null): void {
  if (label === null) return;
  const el = parent.createSpan({ cls: `${DUE_SLOT_CLASS} ${TASK_PILL_CLASS}`, text: label.text });
  el.dataset.state = label.state;
  el.setAttribute("aria-label", t().explorer.dueDate(label.long, label.state));
}
