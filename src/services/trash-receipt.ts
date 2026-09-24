/**
 * Where a trashed file went, so that a delete can be undone.
 *
 * The vault's own trash is a folder the adapter can see into, and a file
 * moved there keeps its name. So the receipt for a delete is, almost always,
 * one path that can be looked up with a single existence check. The one
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

function basenameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
