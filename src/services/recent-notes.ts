/**
 * What the footer's "Recently opened" section lists: the files opened last on
 * this device, the note the footer sits under left out.
 *
 * The list is Obsidian's own (`getLastOpenFiles`), kept in the workspace file
 * of each device, so switching back is one press without the plugin keeping a
 * history of its own. That file is a person's to edit, and a path in it may
 * name something since deleted, renamed or moved to the trash; every entry is
 * checked before it is shown.
 */

/** How many entries the section holds at most: what Obsidian keeps, less one. */
export const MAX_RECENT_NOTES = 10;

/** How many the section shows until it is told to show the rest. */
export const FOLDED_RECENT_NOTES = 3;

/**
 * The paths to list, most recent first: strings only, each once, never the
 * note the footer belongs to, only those `present` vouches for, at most `max`.
 */
export function selectRecent(
  lastOpen: unknown,
  current: string | null,
  present: (path: string) => boolean,
  max: number = MAX_RECENT_NOTES
): string[] {
  if (!Array.isArray(lastOpen)) return [];
  const chosen: string[] = [];
  const seen = new Set<string>();
  for (const entry of lastOpen) {
    if (chosen.length >= max) break;
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (entry === current || seen.has(entry)) continue;
    seen.add(entry);
    if (present(entry)) chosen.push(entry);
  }
  return chosen;
}

/**
 * How many of `total` entries are drawn, and how many wait behind the "show
 * more" row.
 */
export function recentRows(total: number, expanded: boolean): { shown: number; hidden: number } {
  if (expanded || total <= FOLDED_RECENT_NOTES) return { shown: total, hidden: 0 };
  return { shown: FOLDED_RECENT_NOTES, hidden: total - FOLDED_RECENT_NOTES };
}
