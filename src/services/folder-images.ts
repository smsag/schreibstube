/**
 * Which files in a folder are pictures, and in what order to show them.
 *
 * A folder of scans or photos is a list of names in the tree, and the name
 * of a picture says almost nothing. The tile grid answers that; this module
 * decides what goes into it, so the deciding is a test and the view only
 * draws.
 *
 * Direct children only. A subfolder is a row in the tree, and its pictures
 * are that folder's grid, not this one's — a photo archive with a folder per
 * year would otherwise show every year at once from the top.
 *
 * The shape is the vault's, not Obsidian's: a node with a `name`, a `path`,
 * and `children` when it is a folder. A `TFolder` satisfies it and a test
 * builds one in a line.
 */

import type { VaultNode } from "./vault-tree";

/**
 * What an `<img>` can draw.
 *
 * One list, exported, so the menu, the grid and the predicate never disagree
 * about what a picture is. Wider than the list `image-resize` re-encodes for
 * a model — a canvas cannot write SVG or BMP, but a tile can show one.
 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "bmp"
]);

/**
 * How many tiles a grid draws before it stops and says how many more there are.
 *
 * Each tile is an `<img>` the browser will decode once it scrolls into view;
 * four hundred is a long afternoon of scrolling and still a page a phone can
 * hold. Past it the answer is a folder of its own, not a longer grid.
 */
export const MAX_TILES = 400;

/** A node as the grid needs to read it: a `TFolder` or a `TFile`, or a test's stand-in. */
export interface NamedNode extends VaultNode {
  name: string;
  children?: readonly NamedNode[];
}

export interface FolderImage {
  path: string;
  name: string;
}

export interface FolderImages {
  images: FolderImage[];
  /** How many pictures the folder holds beyond those drawn. */
  held: number;
}

export interface FolderImageOptions {
  /** The most to draw; the rest are counted in `held`. */
  max?: number;
  /** Paths the pane has already taken away, which the vault has not confirmed. */
  gone?: (path: string) => boolean;
}

/** Whether a file name ends in an extension a tile can show. No dot, or a dot only at the front, is no extension. */
export function isImageName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * The same order the tree uses, so `Bild 2` precedes `Bild 10` in both places.
 *
 * Not `sortSiblings`: that one also lifts files kept at the top of their
 * folder, which is a fact about the tree and means nothing in a grid.
 */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The folder's own pictures, in name order, up to `max`, and how many were left out. */
export function folderImages(folder: NamedNode, options: FolderImageOptions = {}): FolderImages {
  const max = options.max ?? MAX_TILES;
  const gone = options.gone ?? (() => false);

  const all = (folder.children ?? [])
    .filter((child) => child.children === undefined && isImageName(child.name) && !gone(child.path))
    .map((child) => ({ path: child.path, name: child.name }))
    .sort((a, b) => byName.compare(a.name, b.name));

  const images = all.slice(0, Math.max(0, max));
  return { images, held: all.length - images.length };
}

/**
 * Whether the folder holds at least one picture of its own.
 *
 * Stops at the first, because the menu asks this every time it opens on a
 * folder and a folder of a thousand scans should not be listed to answer.
 */
export function hasFolderImages(
  folder: NamedNode,
  gone: (path: string) => boolean = () => false
): boolean {
  return (folder.children ?? []).some(
    (child) => child.children === undefined && isImageName(child.name) && !gone(child.path)
  );
}
