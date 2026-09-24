/**
 * What "latest" means, given a vault: the notes whose source last changed.
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

export interface LatestOptions {
  /** How many rows the list shows. */
  count: number;
  /** Paths never shown: a file, or a folder standing for everything under it. */
  excluded?: ReadonlySet<string>;
}

/** The ceiling on the count setting. High enough to be useless to exceed,
 *  low enough that the section cannot become the whole pane. */
export const LATEST_COUNT_MAX = 50;
export const LATEST_COUNT_DEFAULT = 5;

/**
 * The newest moment a source changed, across the notes shown as updated.
 *
 * Read from the list the pane draws rather than from every record, so what the
 * mark stands for is exactly what a tap on it shows: a note excluded from the
 * section, or beyond the count it holds, cannot leave a mark pointing at a list
 * it is not in.
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

export function selectLatest(
  candidates: readonly LatestCandidate[],
  { count, excluded }: LatestOptions
): LatestSelection {
  if (count <= 0) return { synced: [] };

  // Normalised once rather than per file: the list is a handful of entries and
  // the vault is thousands of notes.
  const barred = excluded && excluded.size > 0 ? normalizeExcluded(excluded) : [];

  const synced = candidates
    .filter((file) => file.syncedAt !== undefined && !isExcluded(file.path, barred))
    .sort((a, b) => (b.syncedAt ?? 0) - (a.syncedAt ?? 0) || compareName(a, b))
    .slice(0, count);

  return { synced };
}

/**
 * The exclusion list as a person writes it in the settings field: paths
 * separated by commas or newlines, because both are what people type.
 */
export function parseExcludedPaths(value: string): Set<string> {
  return new Set(
    value
      .split(/[,\n]/)
      .map((entry) => entry.trim().replace(/^\/+/, "").replace(/\/+$/, ""))
      .filter((entry) => entry.length > 0)
  );
}

/**
 * Whether a path is excluded by one of the entries.
 *
 * A folder stands for everything under it. Nobody types out every note in a
 * private folder, and a folder is what a person means when they write one into
 * a field called "never show these" — so an entry that names a folder excluded
 * nothing at all, silently, which is the worst way for this particular setting
 * to fail.
 *
 * Compared without case, because the filesystems this runs on — macOS, iOS,
 * Windows — do not distinguish it either, and a person typing the path from
 * memory should not have to.
 */
export function isExcluded(path: string, excluded: readonly string[]): boolean {
  const candidate = path.toLowerCase();

  // A separator is required, so "Familie" does not take "Familienrecht/x.md"
  // with it.
  return excluded.some((entry) => candidate === entry || candidate.startsWith(`${entry}/`));
}

/** The entries as `isExcluded` wants them: trimmed of slashes, lower case. */
export function normalizeExcluded(excluded: Iterable<string>): string[] {
  const entries: string[] = [];
  for (const entry of excluded) {
    const cleaned = entry.trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
    if (cleaned.length > 0) entries.push(cleaned);
  }
  return entries;
}

/** A stable tie-break, so two notes written in the same millisecond do not
 *  swap places between two redraws. */
function compareName(a: LatestCandidate, b: LatestCandidate): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
