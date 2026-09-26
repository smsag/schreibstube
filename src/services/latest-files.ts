/**
 * What the pane's "Updated externally" section lists: the notes whose source
 * last changed.
 *
 * One list, of the notes a Document sync source has moved and that still wait
 * to be looked at. A note created or edited in the vault is already at the top
 * of Obsidian's own recent files; what the pane can say that nothing else does
 * is that something outside the vault changed it.
 */

/** One vault file, reduced to what the ordering needs. */
export interface LatestCandidate {
  path: string;
  /** What the row shows: the note's basename, not its path. */
  name: string;
  /**
   * When this note's source was last seen to have changed, if it mirrors one.
   *
   * Not when it was checked, and not when its changes were applied: the moment
   * the document at the other end moved.
   */
  syncedAt?: number;
}

export interface LatestSelection {
  /** Mirrored notes whose source changed, newest first. */
  synced: LatestCandidate[];
}

/**
 * The most rows the section shows. Every note still waiting is listed — it is
 * what is left to look at, and a sixth one held back would be one nobody
 * looks at — but a vault that mirrors hundreds of sources must not turn the
 * section into the whole pane.
 */
export const LATEST_MAX = 50;

/**
 * The newest moment a source changed, across the notes shown as updated.
 *
 * Read from the list the pane draws rather than from every record, so what the
 * mark stands for is exactly what a tap on it shows: a note beyond the ceiling
 * the section holds cannot leave a mark pointing at a list it is not in.
 */
export function newestSync(files: readonly LatestCandidate[]): number | null {
  let newest: number | null = null;

  for (const file of files) {
    if (file.syncedAt === undefined) continue;
    if (newest === null || file.syncedAt > newest) newest = file.syncedAt;
  }

  return newest;
}

/**
 * Whether a source has changed since this device last looked.
 *
 * Strictly newer than the moment that was acknowledged: a change is seen once,
 * and acknowledging the newest one acknowledges everything older with it.
 */
export function hasUnseenSync(files: readonly LatestCandidate[], seenAt: number): boolean {
  const newest = newestSync(files);
  return newest !== null && newest > seenAt;
}

/** The notes whose source changed and wait to be looked at, newest first. */
export function selectLatest(candidates: readonly LatestCandidate[]): LatestSelection {
  const synced = candidates
    .filter((file) => file.syncedAt !== undefined)
    .sort((a, b) => (b.syncedAt ?? 0) - (a.syncedAt ?? 0) || compareName(a, b))
    .slice(0, LATEST_MAX);

  return { synced };
}

/** A stable tie-break, so two notes written in the same millisecond do not
 *  swap places between two redraws. */
function compareName(a: LatestCandidate, b: LatestCandidate): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
