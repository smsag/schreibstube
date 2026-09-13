/**
 * What "latest" means, given a vault.
 *
 * Two lists: the notes most recently created, and the notes most recently
 * changed. They overlap almost completely in a young vault, because a note
 * created ten minutes ago was also changed ten minutes ago, and a section that
 * shows the same five notes twice is a section nobody reads. So the modified
 * list is drawn from what the created list did not already take.
 *
 * Only Markdown counts. An attachment written by a paste is the most recently
 * created file in the vault more often than any note is, and it is never what
 * the person was looking for.
 */

/** One vault file, reduced to what the ordering needs. */
export interface LatestCandidate {
  path: string;
  /** What the row shows: the note's basename, not its path. */
  name: string;
  createdAt: number;
  modifiedAt: number;
}

export interface LatestSelection {
  created: LatestCandidate[];
  modified: LatestCandidate[];
}

export interface LatestOptions {
  /** How many rows each subsection shows. */
  count: number;
  /**
   * Paths never shown: a file, or a folder standing for everything under it.
   * The bookmarks file is the usual single file.
   */
  excluded?: ReadonlySet<string>;
}

/** The ceiling on the count setting. High enough to be useless to exceed,
 *  low enough that the section cannot become the whole pane. */
export const LATEST_COUNT_MAX = 50;
export const LATEST_COUNT_DEFAULT = 5;

export function selectLatest(
  candidates: readonly LatestCandidate[],
  { count, excluded }: LatestOptions
): LatestSelection {
  if (count <= 0) return { created: [], modified: [] };

  // Normalised once rather than per file: the list is a handful of entries and
  // the vault is thousands of notes.
  const barred = excluded && excluded.size > 0 ? normalizeExcluded(excluded) : [];

  const eligible =
    barred.length > 0
      ? candidates.filter((file) => !isExcluded(file.path, barred))
      : [...candidates];

  const created = [...eligible]
    .sort((a, b) => b.createdAt - a.createdAt || compareName(a, b))
    .slice(0, count);

  const taken = new Set(created.map((file) => file.path));
  const modified = eligible
    .filter((file) => !taken.has(file.path))
    .sort((a, b) => b.modifiedAt - a.modifiedAt || compareName(a, b))
    .slice(0, count);

  return { created, modified };
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
