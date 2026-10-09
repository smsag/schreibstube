/**
 * How many tasks a note holds, and how many are still open, for a row in
 * the file pane.
 *
 * Counted from Obsidian's own metadata rather than from the note's text, so
 * a pane drawing a thousand rows reads no files. What a marker means is
 * `task-state`'s to say, the same rule the ribbon and **Tidy up done tasks**
 * read: finished is `[x]` and `[-]`, everything else is open, and `[/]` is
 * open work somebody has started.
 */
import { taskState } from "./task-state";

/** The one field of Obsidian's list item cache the count reads. */
export interface TaskItem {
  /** The character in the box; undefined when the item is not a task. */
  task?: string | undefined;
}

export interface TaskTally {
  open: number;
  total: number;
  /** Of the open ones, those marked `[/]`: started, not finished. */
  progress?: number;
}

/** Frontmatter a note carries to keep its tasks out of the Explorer's counts. */
export const TASK_COUNT_KEY = "schreibstubeTaskCount";

/**
 * Whether a note's tasks are counted in the Explorer: on its own row, and in
 * the sum a pinned tag shows. Only `false` says anything — or the string
 * "false" a hand-edited or synced property often turns into, read as
 * `schreibstubeIndex` is. Without the key the Explorer's setting decides, and
 * `true` asks for nothing that setting does not already give.
 */
export function countsTasks(frontmatter: unknown): boolean {
  if (!frontmatter || typeof frontmatter !== "object") return true;
  const value = (frontmatter as Record<string, unknown>)[TASK_COUNT_KEY];
  return value !== false && value !== "false";
}

export function tallyTasks(items: readonly TaskItem[] | undefined): TaskTally {
  let open = 0;
  let progress = 0;
  let total = 0;
  for (const item of items ?? []) {
    if (item.task === undefined) continue;
    total += 1;
    const state = taskState(item.task);
    if (state !== "done") open += 1;
    if (state === "progress") progress += 1;
  }
  return { open, total, progress };
}

/** The two numbers a row shows, and whether there is anything left to do. */
export interface TaskCount {
  /** Tasks ticked off — the LEADING number. */
  done: number;
  total: number;
  /** Open tasks already started, for the label; the figures do not show it. */
  progress: number;
  /** Nothing open. The row draws itself quietly when this is true. */
  complete: boolean;
}

/**
 * What the row shows after the name: DONE over total, or nothing at all for a
 * note with no tasks, since a nought would be noise on most rows.
 *
 * Done leads, not open. `x / y` is read as progress by everyone who has ever
 * seen a progress figure, so a note with seven untouched tasks labelled
 * `7 / 7` announced itself as finished — the exact opposite of the truth, and
 * of what the aria-label said. The form stays; the numbers now mean what the
 * form already implied.
 */
export function taskCount(tally: TaskTally): TaskCount | null {
  if (tally.total <= 0) return null;
  const done = tally.total - tally.open;
  return { done, total: tally.total, progress: tally.progress ?? 0, complete: tally.open === 0 };
}
