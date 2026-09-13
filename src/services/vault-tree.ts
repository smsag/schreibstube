/**
 * The vault as a shape, so what is asked of it can be decided in one place.
 *
 * A tree is walked for two different questions — how much a closed folder is
 * holding, and which folders exist at all — and neither of them needs Obsidian's
 * classes to answer. Both take this shape instead, which is what lets them be
 * tested against a handful of objects rather than against an app.
 */

/**
 * A vault node as a walk sees it: a folder has children, a file does not.
 *
 * The path is not used by every walk, only required: a shape whose every field
 * is optional accepts anything at all, and this one should accept a vault.
 */
export interface VaultNode {
  path: string;
  children?: readonly VaultNode[];
}

/**
 * Every folder underneath this one, its own path excluded.
 *
 * The root is left out because it is not a row: nothing in the pane can open or
 * close the vault itself. Order is the vault's own, shallowest first, which is
 * the order the tree draws them in.
 */
export function folderPathsUnder(folder: VaultNode): string[] {
  const paths: string[] = [];

  for (const child of folder.children ?? []) {
    if (child.children === undefined) continue;
    paths.push(child.path);
    paths.push(...folderPathsUnder(child));
  }

  return paths;
}

/**
 * What one control over the whole tree should do next.
 *
 * A single button, because two would need a person to read which is which. It
 * offers to close while anything at all is open, and only a tree that is shut
 * all the way offers to open — so pressing it twice always returns the tree to
 * where it was.
 */
export function treeAction(
  paths: readonly string[],
  isOpen: (path: string) => boolean
): "expand" | "collapse" {
  return paths.some((path) => isOpen(path)) ? "collapse" : "expand";
}
