/**
 * The due day as it appears at a row's right edge.
 *
 * It wears the task pill's class, so the padding, the corner and the accent
 * wash the stylesheet measured for the tally are the same rule here, not a
 * copy that drifts from it. Its state says which of those it keeps: a day
 * still ahead drops the fill, today keeps it, and a missed day adds an outline
 * — a shape, so the three read apart without telling one colour from another.
 *
 * Every Markdown row gets the slot while due dates are on, an empty one where
 * the note names no day. The slot has a fixed width at the right edge, so the
 * dates line up down the pane and the task counts line up against them.
 */
import { t } from "../i18n";
import type { DueLabel } from "../services/due-date";
import { TASK_PILL_CLASS } from "./task-count-label";

export const DUE_SLOT_CLASS = "schreibstube-explorer-due";

export function drawDueDate(parent: HTMLElement, label: DueLabel | null): void {
  const cls = `${DUE_SLOT_CLASS} ${TASK_PILL_CLASS}`;
  if (label === null) {
    const empty = parent.createSpan({ cls });
    empty.dataset.state = "none";
    empty.setAttribute("aria-hidden", "true");
    return;
  }
  const el = parent.createSpan({ cls, text: label.text });
  el.dataset.state = label.state;
  el.setAttribute("aria-label", t().explorer.dueDate(label.long, label.state));
}
