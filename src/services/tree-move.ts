/**
 * Where a dragged row is allowed to land.
 *
 * Moving a file is the one thing this pane does that cannot be undone with a
 * click, so every reason to refuse is decided here, as a pure function over
 * paths, rather than inside a pointer handler where it cannot be tested.
 *
 * The vault root is the empty string, which is how Obsidian names it too.
 */
import { t } from "../i18n";
import { basename } from "./file-name";

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
  // Case-insensitive because macOS and Windows keep both spellings in one
  // slot; a Linux vault loses a move it could have made, which is the cheaper
  // mistake next to a move the adapter refuses after the plan said yes.
  if (takenIgnoringCase(context.taken).has(destination.toLowerCase())) return "name-taken";

  return { destination };
}

/**
 * The taken paths folded to lower case, once per set.
 *
 * macOS and Windows keep `Notiz.md` and `notiz.md` in one slot, so a move the
 * exact comparison allowed failed in the vault afterwards, with the generic
 * notice. Folded once and remembered, because the "Move to…" list asks for
 * every folder against the same set.
 */
const FOLDED = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>();
function takenIgnoringCase(taken: ReadonlySet<string>): ReadonlySet<string> {
  let folded = FOLDED.get(taken);
  if (!folded) {
    folded = new Set([...taken].map((path) => path.toLowerCase()));
    FOLDED.set(taken, folded);
  }
  return folded;
}

export function isMovePlan(result: MovePlan | MoveRefusal): result is MovePlan {
  return typeof result !== "string";
}

/**
 * Every folder the item could be moved into, the vault root first.
 *
 * What the "Move to…" list offers. A destination that would be refused is left
 * out rather than shown and then rejected: the folder it already sits in, its
 * own subtree, and anything already holding a file of that name. On a touch
 * screen this list is the only way to move anything, since the long press
 * belongs to the context menu.
 */
export function moveDestinations(sourcePath: string, context: MoveContext): string[] {
  const folders = ["", ...context.folders];

  return folders
    .filter((folder) => isMovePlan(planMove(sourcePath, folder, context)))
    .sort((left, right) => {
      // The root is where a file is moved to be got out of everywhere, so it
      // leads rather than sorting under the empty string.
      if (left.length === 0) return -1;
      if (right.length === 0) return 1;
      return left.localeCompare(right);
    });
}

/** Why a move was refused, as a line to show the person who asked for it. */
export function moveRefusalMessage(refusal: MoveRefusal, name: string): string {
  const messages = t().explorer.move;
  switch (refusal) {
    case "into-itself":
    case "into-descendant":
      return messages.intoItself(name);
    case "name-taken":
      return messages.nameTaken(name);
    default:
      return messages.failed(name);
  }
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
