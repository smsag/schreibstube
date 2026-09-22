/**
 * Two devices' sync records, made into one.
 *
 * The records live in the plugin's data file, and the data file travels with
 * the vault. Each device kept its own copy in memory and wrote the whole of it
 * back on every save, so whichever device saved last decided what every device
 * knew: an update fetched and accepted on the laptop was forgotten the moment
 * the phone saved, and the phone's next check reported it again — as a change
 * the note already held.
 *
 * The records are merged per note instead. Each one says when it was made, and
 * the later check knows more: it saw the source at least as recently, and it
 * settled on whatever the note held by then.
 */
import type { SyncRecord } from "./sync-document";

export interface SyncMergeInput {
  /** What this device holds. */
  local: Record<string, SyncRecord>;
  /** What the data file holds, as another device last wrote it. */
  disk: Record<string, SyncRecord>;
  /**
   * Records this device dropped since it last read the file, with when.
   *
   * Without them a record unbound here comes straight back from the file it
   * was dropped from. A record the file holds from a check made after the
   * drop is a note bound again elsewhere, and it is kept.
   */
  dropped?: ReadonlyMap<string, number>;
}

export function mergeSyncState({
  local,
  disk,
  dropped
}: SyncMergeInput): Record<string, SyncRecord> {
  const merged: Record<string, SyncRecord> = { ...local };

  for (const [path, theirs] of Object.entries(disk)) {
    const ours = local[path];

    if (ours === undefined) {
      const droppedAt = dropped?.get(path);
      if (droppedAt !== undefined && theirs.checkedAt <= droppedAt) continue;
      merged[path] = theirs;
      continue;
    }

    // A tie keeps this device's: the same check read back, most likely, and
    // nothing to choose between.
    if (theirs.checkedAt > ours.checkedAt) merged[path] = theirs;
  }

  return merged;
}

/** Whether two sets of records say the same thing, so an unchanged merge
 *  costs no save and no redraw. */
export function sameSyncState(
  a: Record<string, SyncRecord>,
  b: Record<string, SyncRecord>
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) => b[key] !== undefined && JSON.stringify(a[key]) === JSON.stringify(b[key])
  );
}
