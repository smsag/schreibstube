/**
 * Which rows of Obsidian's link suggestions are pictures.
 *
 * After `[[` or `![[` the list names files, and the name of a picture says
 * almost nothing: `IMG_2041.jpeg` beside `IMG_2042.jpeg`. A thumbnail in the
 * row answers that. This module decides which rows get one, so the deciding
 * is a test and the controller only draws.
 *
 * The row comes from Obsidian's own suggester, whose shape no type declares
 * and any update may change. It is read as unknown and checked field by
 * field; a row that is not plainly a picture file gets nothing, which is how
 * the list looked before.
 */

import { IMAGE_EXTENSIONS } from "./folder-images";

/**
 * The largest picture a row draws.
 *
 * A thumbnail is the whole file decoded and scaled down, and the list can
 * hold dozens of rows. A photo or a scan is a few megabytes; past this it is
 * a poster or a panorama, and a phone that decodes several of them for a
 * list of names runs out of memory before the list is read.
 */
export const MAX_THUMBNAIL_BYTES = 16 * 1024 * 1024;

export interface SuggestedImage {
  /** The picture's path in the vault. */
  path: string;
  /** A drawing is shown whole; a photo fills the square and loses its edges. */
  fit: "cover" | "contain";
}

/**
 * The picture a suggestion row stands for, or null when it stands for
 * anything else: a note, an alias, a heading, a link to nothing yet.
 *
 * Only a row of type `file` counts. An alias row for a picture is Obsidian
 * offering a size (`![[bild.png|300]]`), which is a different question.
 */
export function suggestedImage(item: unknown): SuggestedImage | null {
  if (!isRecord(item) || item.type !== "file" || !isRecord(item.file)) return null;

  const { path, extension, stat } = item.file;
  if (typeof path !== "string" || path.length === 0 || typeof extension !== "string") return null;

  const kind = extension.toLowerCase();
  if (!IMAGE_EXTENSIONS.has(kind)) return null;

  // A file with no known size is drawn: the bound is for the pictures known
  // to be too large, not a reason to hide the rest.
  const size = isRecord(stat) ? stat.size : undefined;
  if (typeof size === "number" && size > MAX_THUMBNAIL_BYTES) return null;

  return { path, fit: kind === "svg" ? "contain" : "cover" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
