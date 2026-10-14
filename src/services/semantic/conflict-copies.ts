// iCloud's "name N" copies of an index file.
//
// When a file iCloud is still syncing is replaced by a new one under the same
// name, iCloud keeps both and puts a number before the last extension:
// `semantic-notes-….journal.bin` beside `semantic-notes-….journal 2.bin`. The
// journal was replaced on every edit until it was written in place, and each
// replacement could leave such a copy, holding that write's edits, while the
// file under the real name held an older set or none.

/** At most this many copies are read for one file; the newest by number. */
export const MAX_CONFLICT_COPIES = 32;

/**
 * The number of the conflict copy `name` is of `original`, or null when it is
 * not one. Both are bare file names. A copy is the original's name with
 * ` N` (N ≥ 2) before its last extension, which is how iCloud names one.
 */
export function conflictCopyNumber(name: string, original: string): number | null {
  const dot = original.lastIndexOf(".");
  const stem = dot > 0 ? original.slice(0, dot) : original;
  const ext = dot > 0 ? original.slice(dot) : "";
  if (!name.startsWith(`${stem} `) || !name.endsWith(ext)) return null;
  const digits = name.slice(stem.length + 1, name.length - ext.length);
  if (!/^[1-9]\d{0,5}$/.test(digits)) return null;
  const n = Number(digits);
  return n >= 2 ? n : null;
}

/** The names in `names` that are conflict copies of `original`, newest first,
 *  no more than MAX_CONFLICT_COPIES of them. */
export function conflictCopies(names: readonly string[], original: string): string[] {
  return names
    .map((name) => ({ name, n: conflictCopyNumber(name, original) }))
    .filter((c): c is { name: string; n: number } => c.n !== null)
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_CONFLICT_COPIES)
    .map((c) => c.name);
}
