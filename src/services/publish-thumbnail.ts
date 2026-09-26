/**
 * The small copies of pictures that a published filmstrip shows under its
 * stage.
 *
 * They are made here, in the vault, because the plugin can decode a picture
 * where the picture is, and the bridge would otherwise need an image library
 * of its own and would decode files from the network to use it. The bridge
 * names each thumbnail after its picture and asks only for the ones the site
 * lacks, so an unchanged photograph is decoded once, on its first publish.
 *
 * Which pictures get one, and in what format, is shared with the bridge in
 * `contracts/slideshow-cases.json`: the bridge serves a thumbnail at a path
 * derived from the same rule, and a disagreement is a thumbnail nobody asks
 * for or one nobody sends.
 */

/** The longest edge. Shown 72 pixels wide at up to three device pixels each. */
export const THUMBNAIL_MAX_PX = 320;

/** Enough for a picture the size of a stamp; a photograph comes out near 20 kB. */
export const THUMBNAIL_QUALITY = 0.8;

/** What the bridge accepts for one thumbnail; one larger is not sent. */
export const MAX_THUMBNAIL_BYTES = 200_000;

/**
 * A PNG keeps its transparency and stays a PNG; a photograph becomes a JPEG.
 * A drawing, an animation or a format a phone may not decode gets none, and
 * the filmstrip shows the picture itself.
 */
const THUMBNAIL_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/jpeg"
};

/** The type a thumbnail of this file is encoded as, or null for none. */
export function thumbnailType(name: string): string | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  return THUMBNAIL_TYPES[extension] ?? null;
}

/** Whether encoded bytes may be sent as a thumbnail at all. */
export function isSendableThumbnail(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_THUMBNAIL_BYTES;
}
