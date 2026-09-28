/**
 * Where a trashed file went, so that a delete can be undone.
 *
 * The vault's own trash is a folder the adapter can see into, and a file
 * moved there keeps its name. So the receipt for a delete is, almost always,
 * one path that can be looked up with a single look. The one
 * exception is a namesake already in the trash: the trash then renames the
 * arrival, and only a listing taken before and after can say what it is
 * called now. The system trash the adapter cannot see into at all, and the
 * receipt is null: that delete cannot be undone from here, and the notice
 * says so.
 */

/** The folder the vault's own trash lives in. Hidden from the vault API,
 *  reachable through the adapter, which is how a deleted file comes back. */
export const LOCAL_TRASH = ".trash";

/** Where the vault's own trash puts a file of this name, when nothing is in the way. */
export function localTrashPath(name: string): string {
  return `${LOCAL_TRASH}/${name}`;
}

/**
 * The entry that arrived in the trash, from a listing before and after.
 *
 * Something else may land in the trash between the two listings — a sync
 * client, another device — so an arrival carrying this file's own name is
 * believed before any other.
 */
export function arrivedReceipt(
  name: string,
  before: readonly string[],
  after: readonly string[]
): string | null {
  const arrived = after.filter((entry) => !before.includes(entry));
  return arrived.find((entry) => basenameOf(entry) === name) ?? arrived[0] ?? null;
}

/** What the trash call was handed, as far as a look in the trash can tell. */
export interface TrashedShape {
  type: "file" | "folder";
  /** A file's size and modification time; a move keeps both. */
  size?: number;
  mtime?: number;
}

/** What the adapter says sits at a path in the trash. */
export interface TrashEntryStat {
  type: "file" | "folder";
  size: number;
  mtime: number;
}

/**
 * Whether the entry found where the file was expected is the file itself.
 *
 * Finding the file's name in the trash is not enough on its own: with the
 * system trash nothing of ours arrives, and a sync client or another device
 * may put a namesake there during the call. An undo built on that receipt
 * would move a stranger onto the deleted file's path. A move keeps a file's
 * size and modification time, so both must match; a folder has neither that
 * can be trusted, and its kind is all there is to go on.
 */
export function isTrashedEntry(shape: TrashedShape, found: TrashEntryStat | null): boolean {
  if (found === null || found.type !== shape.type) return false;
  if (shape.type === "folder") return true;
  return found.size === shape.size && found.mtime === shape.mtime;
}

function basenameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
