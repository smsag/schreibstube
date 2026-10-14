import type { MarkdownPostProcessor } from "obsidian";
import { type DoneTaskVisibility, hidesWithBody } from "../services/done-task-visibility";

export const DONE_TASK_DIMMED_CLASS = "schreibstube-done-task-dimmed";
export const DONE_TASK_HIDDEN_CLASS = "schreibstube-done-task-hidden";

/**
 * Marks finished tasks in Reading view, for the stylesheet to dim or hide.
 *
 * A rendered task is a `li.task-list-item` whose `data-task` holds the mark,
 * and its sub-tasks are list items inside it, so "open work below" is read
 * from the nesting. Reading view renders a note in sections, and a section
 * holds whole lists; each item is judged on its own, which is all a section
 * boundary can split.
 *
 * Only the outermost finished item is marked: a dimmed item inside a dimmed
 * item would be dimmed twice, since opacity multiplies down the tree. The
 * fold that tucks a ticked task's body away (`task-fold-reading`) is left to
 * do its work: a hidden item takes its folded body with it, and a dimmed one
 * is dimmed folded.
 *
 * `modeFor` is asked once per section. When the setting or the note's
 * frontmatter changes, the plugin renders the view again.
 */
export function createDoneTaskReadingPostProcessor(
  modeFor: (sourcePath: string, frontmatter: unknown) => DoneTaskVisibility
): MarkdownPostProcessor {
  return (el, ctx) => {
    const mode = modeFor(ctx.sourcePath, ctx.frontmatter);
    if (mode === "off") return;
    const mark = mode === "dim" ? DONE_TASK_DIMMED_CLASS : DONE_TASK_HIDDEN_CLASS;

    for (const item of Array.from(el.querySelectorAll<HTMLElement>("li.task-list-item"))) {
      if (item.parentElement?.closest(`.${mark}`)) continue;
      const nested = Array.from(item.querySelectorAll("li.task-list-item"), markOf);
      if (hidesWithBody(markOf(item), nested)) item.classList.add(mark);
    }
  };
}

/**
 * The character in an item's box. Obsidian writes it to `data-task`; an
 * item rendered without it — by another plugin's renderer, say — is read by
 * the checked class it still carries, as plain done or open.
 */
function markOf(item: Element): string {
  return item.getAttribute("data-task") ?? (item.classList.contains("is-checked") ? "x" : " ");
}
