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

/**
 * What the row shows after the name: open over total, or nothing at all for
 * a note with no tasks, since a nought would be noise on most rows.
 */
export function taskCountLabel(tally: TaskTally): string | null {
  return tally.total > 0 ? `${tally.open} / ${tally.total}` : null;
}
