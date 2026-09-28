/**
 * A path held by a view, carried along when the vault moves it.
 *
 * Obsidian reports a folder renamed or deleted once, for the folder; every
 * file under it moves or goes without an event of its own. A view holding one
 * of those paths learns about it only by asking whether the event's path is
 * the one it holds or a folder above it.
 */
import { isUnder } from "./tree-move";

/** Whether `path` is `target` itself or lies somewhere under it. */
export function isAtOrUnder(path: string, target: string): boolean {
  return path === target || isUnder(path, target);
}

/** Where `path` is after `from` was renamed to `to`; unchanged when unaffected. */
export function pathAfterMove(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (from.length > 0 && isUnder(path, from)) return `${to}/${path.slice(from.length + 1)}`;
  return path;
}

/** What `folderOf` needs of a file: the folder above it, as Obsidian holds it. */
export interface HasParent {
  parent: { path: string; isRoot(): boolean } | null;
}

/**
 * The folder holding a file, as a list shows it: empty at the vault root.
 *
 * Obsidian's root folder has the path `/`, which is not a folder anybody would
 * recognise under a file's name, so a list reads the root as no folder at all.
 */
export function folderOf(file: HasParent): string {
  return file.parent && !file.parent.isRoot() ? file.parent.path : "";
}
