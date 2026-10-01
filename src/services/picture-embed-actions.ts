/**
 * What Schreibstube adds to the bar Obsidian shows on a picture in Live
 * Preview, beside its own zoom and "edit block": the picture's description,
 * and a star on it.
 *
 * The description is the way in. A picture without one offers to be
 * described, one with a description opens it, and only a picture that has a
 * note can be starred, because the star is a key in that note: the picture
 * itself has no frontmatter to hold it.
 */

export interface PictureActionState {
  /** The description button: open the note, start one, or nothing to offer. */
  describe: "open" | "describe" | null;
  /** The star, on or off; null when there is no note to keep it in. */
  favorite: boolean | null;
}

/**
 * The buttons a picture gets.
 *
 * Describing sends the picture away, so it is offered only while the person
 * has picture descriptions switched on; a description already written is
 * theirs to open and star either way.
 */
export function pictureActionState(input: {
  described: boolean;
  describingEnabled: boolean;
  favorite: unknown;
}): PictureActionState {
  if (input.described) return { describe: "open", favorite: isFavorite(input.favorite) };
  return { describe: input.describingEnabled ? "describe" : null, favorite: null };
}

/**
 * Whether a description note's favourite key says yes. Written by the star as
 * a boolean, but a note is a file anyone edits, so the word a person would
 * type counts too; anything else is no.
 */
export function isFavorite(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

/** A link longer than this is no picture's name; it is not resolved. */
const MAX_EMBED_LINK = 1024;

/**
 * The vault path an embed was written with, as Obsidian keeps it on the embed:
 * `bild.png` from `![[bild.png|300]]`, without a heading, a block or a size.
 * Null for a web address, which names no file to describe, and for anything
 * that is not a usable link.
 */
export function embedLinkpath(src: unknown): string | null {
  if (typeof src !== "string" || src.length > MAX_EMBED_LINK) return null;
  const path = src.split(/[#|]/)[0]?.trim() ?? "";
  if (path.length === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return path;
}
