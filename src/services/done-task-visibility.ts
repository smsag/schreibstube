/**
 * Showing finished tasks quieter, or not at all, without touching the note.
 *
 * A long checklist hides its open work between the ticked lines, but the
 * ticked lines are the record a status report is written from, so they stay
 * in the file. This is display only: Live Preview and Reading view dim or
 * hide them, Source mode and paper show the note as it is.
 *
 * Finished is `task-state`'s rule: done, `[x]` or `[X]`, and cancelled, `[-]`.
 * Everything else, `[/]` and the flags a theme gives meaning to included, is
 * open work and stays. A finished task goes together with everything indented
 * under it — a note typed with Shift+Enter, its finished sub-tasks — unless
 * an open task sits anywhere below it: then it stays, so the open sub-task
 * keeps the line that says what it belongs to. Its own finished sub-tasks are
 * judged on their own, as tasks in their own right.
 */
import { taskBodyRange, type LineRange } from "./task-fold";
import { listTasks } from "./task-summary";
import { isOpenTask } from "./task-state";

export const DONE_TASK_VISIBILITIES = ["off", "dim", "hide"] as const;
export type DoneTaskVisibility = (typeof DONE_TASK_VISIBILITIES)[number];

/**
 * Off, so that an update changes nothing anyone sees until they ask for it:
 * a note that suddenly loses half its lines reads as lost work.
 */
export const DEFAULT_DONE_TASK_VISIBILITY: DoneTaskVisibility = "off";

/** The setting as read from `data.json`, which a person can edit by hand. */
export function normalizeDoneTaskVisibility(value: unknown): DoneTaskVisibility {
  return DONE_TASK_VISIBILITIES.find((mode) => mode === value) ?? DEFAULT_DONE_TASK_VISIBILITY;
}

/** Frontmatter a note carries to show its finished tasks whatever the setting says. */
export const HIDE_DONE_TASKS_KEY = "schreibstubeHideDoneTasks";

/**
 * What a note's frontmatter says about its finished tasks: `false` shows them
 * all, `true` asks for the setting, and anything else says nothing. The
 * strings `"true"` and `"false"` are read as the booleans, the way a
 * hand-edited or synced property often arrives (as `schreibstubeTaskCount`
 * reads them); a value that is neither is ignored, so the setting applies.
 */
export function normalizeHideDoneTasks(frontmatter: unknown): boolean | null {
  if (!frontmatter || typeof frontmatter !== "object") return null;
  const value = (frontmatter as Record<string, unknown>)[HIDE_DONE_TASKS_KEY];
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

/**
 * What one note shows. Only `false` overrides: `true` is the setting again,
 * which lets a note carry a checkbox in Properties that can be unticked
 * without first being typed in.
 */
export function effectiveVisibility(
  setting: DoneTaskVisibility,
  override: boolean | null
): DoneTaskVisibility {
  return override === false ? "off" : setting;
}

/** Whether a task's box marks it finished: done or cancelled. */
export function isFinishedMark(mark: string): boolean {
  return !isOpenTask(mark);
}

/**
 * Whether a finished task goes, judged by the marks of the tasks nested
 * anywhere under it. This is the rule Reading view applies to a rendered
 * list item, where the nesting is the DOM's rather than the indentation's.
 */
export function hidesWithBody(mark: string, nestedMarks: readonly string[]): boolean {
  return isFinishedMark(mark) && !nestedMarks.some(isOpenTask);
}

/** Where the frontmatter ends, so a `- [x]` in a YAML list is not taken for a task. */
function bodyStart(lines: readonly string[]): number {
  if (lines[0] !== "---") return 0;
  const close = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
  return close > 0 ? close + 1 : 0;
}

/**
 * The line ranges a note's finished tasks occupy, each task with its body,
 * in document order and never nested: a range already covers whatever
 * finished task is inside it. Zero-based and inclusive, like a fold's.
 *
 * Fenced code is read as code, by the same reader that counts tasks.
 */
export function finishedTaskRanges(content: string): LineRange[] {
  const lines = content.split(/\r?\n/);
  const first = bodyStart(lines);
  const tasks = listTasks(content).filter((task) => task.line >= first);
  const ranges: LineRange[] = [];
  let coveredTo = -1;

  for (const [index, task] of tasks.entries()) {
    if (task.open || task.line <= coveredTo) continue;
    const end = taskBodyRange(lines, task.line)?.end ?? task.line;
    let openBelow = false;
    for (let next = index + 1; next < tasks.length; next += 1) {
      const nested = tasks[next];
      if (!nested || nested.line > end) break;
      if (nested.open) {
        openBelow = true;
        break;
      }
    }
    if (openBelow) continue;
    ranges.push({ start: task.line, end });
    coveredTo = end;
  }

  return ranges;
}

/**
 * The ranges to draw dimmed or hidden, given the lines the selection touches.
 * A range the cursor or a selection is in is drawn in full, so nobody types
 * into a line they cannot see or can barely read; the whole task comes back
 * rather than the one line, so what is being edited keeps its context.
 */
export function rangesAwayFrom(
  ranges: readonly LineRange[],
  selected: readonly LineRange[]
): LineRange[] {
  return ranges.filter(
    (range) => !selected.some((sel) => sel.start <= range.end && sel.end >= range.start)
  );
}

/**
 * Ranges that follow each other without a line between them, as one. Two
 * finished tasks one under the other are hidden as one block, so the line
 * break between them is inside it rather than left standing on its own.
 */
export function mergeAdjacentRanges(ranges: readonly LineRange[]): LineRange[] {
  const merged: LineRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start === last.end + 1) last.end = range.end;
    else merged.push({ ...range });
  }
  return merged;
}
