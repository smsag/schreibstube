/**
 * Which folders have to be made before a file can be written at a path.
 *
 * Two features used to answer this differently: one made only the file's own
 * folder and failed when its parent was missing, the other walked every
 * ancestor. The walk is the right answer and it is a decision about paths, so
 * it lives here, once, and both features ask it.
 *
 * Asked against the vault's index rather than the disk: the index is what
 * `createFolder` refuses a duplicate against and what `create` writes into.
 */

/**
 * The folders missing between the root and `path`, outermost first, so that
 * creating them in this order never asks for a folder whose parent is not
 * there yet. `path` is the folder wanted, not the file.
 */
export function missingAncestors(path: string, exists: (folder: string) => boolean): string[] {
  const missing: string[] = [];
  let walked = "";
  for (const part of path.split("/")) {
    if (part.length === 0) continue;
    walked = walked.length > 0 ? `${walked}/${part}` : part;
    if (!exists(walked)) missing.push(walked);
  }
  return missing;
}

/** The folder a file at `path` sits in; empty at the vault root. */
export function folderOfPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}
