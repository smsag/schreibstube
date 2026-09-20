/**
 * How many tasks a note holds, and how many are still open, for a row in
 * the file pane.
 *
 * Counted from Obsidian's own metadata rather than from the note's text, so
 * a pane drawing a thousand rows reads no files. The rule for open is the
 * one the task ribbon uses: a space in the box is open, anything else is
 * done, whatever else a theme makes of the marker.
 */

/** The one field of Obsidian's list item cache the count reads. */
export interface TaskItem {
  /** The character in the box; undefined when the item is not a task. */
  task?: string | undefined;
}

export interface TaskTally {
  open: number;
  total: number;
}

export function tallyTasks(items: readonly TaskItem[] | undefined): TaskTally {
  let open = 0;
  let total = 0;
  for (const item of items ?? []) {
    if (item.task === undefined) continue;
    total += 1;
    if (item.task === " ") open += 1;
  }
  return { open, total };
}

/** The two numbers a row shows, and whether there is anything left to do. */
export interface TaskCount {
  /** Tasks ticked off — the LEADING number. */
  done: number;
  total: number;
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
  return { done, total: tally.total, complete: tally.open === 0 };
}
