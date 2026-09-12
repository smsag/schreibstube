/**
 * Where a dragged row is allowed to land.
 *
 * Moving a file is the one thing this pane does that cannot be undone with a
 * click, so every reason to refuse is decided here, as a pure function over
 * paths, rather than inside a pointer handler where it cannot be tested.
 *
 * The vault root is the empty string, which is how Obsidian names it too.
 */

export type MoveRefusal =
  "same-folder" | "into-itself" | "into-descendant" | "name-taken" | "not-a-folder";

export interface MovePlan {
  /** Where the item ends up, ready for `fileManager.renameFile`. */
  destination: string;
}

export interface MoveContext {
  /** Every path in the vault, so a collision is caught before anything moves. */
  taken: ReadonlySet<string>;
  /** Paths that are folders. A file cannot be moved into another file. */
  folders: ReadonlySet<string>;
}

export function planMove(
  sourcePath: string,
  targetFolder: string,
  context: MoveContext
): MovePlan | MoveRefusal {
  if (targetFolder.length > 0 && !context.folders.has(targetFolder)) return "not-a-folder";

  const name = basename(sourcePath);
  if (parentOf(sourcePath) === targetFolder) return "same-folder";

  if (context.folders.has(sourcePath)) {
    if (targetFolder === sourcePath) return "into-itself";
    // A folder cannot swallow itself: the move would orphan everything under it.
    if (isUnder(targetFolder, sourcePath)) return "into-descendant";
  }

  const destination = targetFolder.length > 0 ? `${targetFolder}/${name}` : name;
  if (context.taken.has(destination)) return "name-taken";

  return { destination };
}

export function isMovePlan(result: MovePlan | MoveRefusal): result is MovePlan {
  return typeof result !== "string";
}

/** Whether `path` sits anywhere inside `folder`. */
export function isUnder(path: string, folder: string): boolean {
  return folder.length === 0 ? path.length > 0 : path.startsWith(`${folder}/`);
}

/**
 * Every folder above a path, outermost first.
 *
 * What a reveal has to open to put a row on screen. The path's own segment is
 * not included: revealing a file opens the folders holding it, not the file.
 */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  parts.pop();

  const ancestors: string[] = [];
  let current = "";
  for (const part of parts) {
    current = current.length > 0 ? `${current}/${part}` : part;
    ancestors.push(current);
  }
  return ancestors;
}

export function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export function basename(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
