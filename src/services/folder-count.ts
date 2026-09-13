/**
 * How much a closed folder is holding.
 *
 * A closed folder says nothing about itself: it is a name and an arrow, and
 * whether it holds two notes or two hundred is only learned by opening it. The
 * count goes on the folder's own icon, which is why it has to be one short
 * figure rather than a true one — a badge is read at a glance or not at all.
 *
 * Kept pure, and over the shape of a vault rather than Obsidian's classes, so
 * the counting and the capping are decided here with tests rather than inside a
 * row being drawn.
 */

/**
 * A vault node as counting sees it: a folder has children, a file does not.
 *
 * The path is not used, only required: a shape whose every field is optional
 * accepts anything at all, and this one should accept a vault.
 */
export interface CountableNode {
  path: string;
  children?: readonly CountableNode[];
}

/** Beyond this the badge stops counting and starts saying "many". */
export const FOLDER_COUNT_MAX = 99;

/**
 * Every file underneath a folder, its subfolders included.
 *
 * Folders themselves are not counted: a folder is not a thing the vault holds,
 * it is where the vault holds things. `gone` takes out what the vault still
 * lists but the pane has already stopped drawing.
 */
export function countFilesUnder(
  folder: CountableNode,
  gone: (path: string) => boolean = () => false
): number {
  let total = 0;

  for (const child of folder.children ?? []) {
    // A file deleted a moment ago is out of the tree already; the badge over
    // that tree must not still be counting it.
    if (gone(child.path)) continue;
    total += child.children === undefined ? 1 : countFilesUnder(child, gone);
  }

  return total;
}

/**
 * The figure a badge shows, or null when there is nothing worth showing.
 *
 * An empty folder carries none: a nought says nothing that a folder opening on
 * nothing does not already say, and a row is quieter without it.
 */
export function folderCountLabel(count: number, max: number = FOLDER_COUNT_MAX): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > max ? `${max}+` : String(Math.floor(count));
}
