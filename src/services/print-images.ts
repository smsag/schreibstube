/**
 * Which pictures a print can carry, and what they become on the way.
 *
 * A picture is decoded by the browser and drawn again at the size it prints,
 * so any format the device can show can be printed — the list below is what
 * the browser is asked to decode, not what Typst reads. What comes out is one
 * of the formats Typst does read, and the file inside the job is named for
 * what it now is: Typst tells a format by its extension, and a GIF drawn again
 * as PNG but still called `.gif` stopped the whole document ("malformed GIF
 * header"). An AVIF, which Typst does not read at all, was turned away before
 * it was even opened and reported as not found.
 *
 * SVG is the exception: Typst draws it itself, as lines rather than pixels, so
 * it goes into the job as it is.
 */

export type PrintImageFormat =
  | {
      kind: "raster";
      /** What the browser is told the bytes are, so it can decode them. */
      sourceType: string;
      /** What they are drawn again as: a format Typst reads. */
      outputType: "image/jpeg" | "image/png" | "image/webp";
    }
  | { kind: "vector" };

/**
 * Photographs stay JPEG — as PNG an AVIF from a phone would weigh several
 * times as much — and anything with sharp edges or transparency stays PNG.
 * HEIC is what an iPhone takes; a device that cannot decode it says so when
 * the picture is read, rather than here.
 */
const RASTER: Readonly<Record<string, [string, "image/jpeg" | "image/png" | "image/webp"]>> = {
  jpg: ["image/jpeg", "image/jpeg"],
  jpeg: ["image/jpeg", "image/jpeg"],
  png: ["image/png", "image/png"],
  webp: ["image/webp", "image/webp"],
  gif: ["image/gif", "image/png"],
  bmp: ["image/bmp", "image/png"],
  avif: ["image/avif", "image/jpeg"],
  heic: ["image/heic", "image/jpeg"],
  heif: ["image/heif", "image/jpeg"]
};

/** How a picture with this extension is printed, or null when it cannot be. */
export function printImageFormat(extension: string): PrintImageFormat | null {
  const ext = extension.toLowerCase();
  if (ext === "svg") return { kind: "vector" };
  const known = RASTER[ext];
  return known ? { kind: "raster", sourceType: known[0], outputType: known[1] } : null;
}

const EXTENSION: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

/**
 * The name a picture is given inside the job: its vault path, with an
 * extension for what the bytes are after printing has drawn them. A path that
 * already says so is kept; one that does not keeps its own extension too and
 * gains the right one — `IMG_2443.avif.jpg` — so it can never be mistaken for
 * a JPEG of the same name beside it.
 */
export function printAssetName(vaultPath: string, format: PrintImageFormat): string {
  if (format.kind === "vector") return vaultPath;
  const wanted = EXTENSION[format.outputType] ?? "png";
  const current = /\.([^./]+)$/.exec(vaultPath)?.[1]?.toLowerCase() ?? "";
  const same = current === wanted || (wanted === "jpg" && current === "jpeg");
  return same ? vaultPath : `${vaultPath}.${wanted}`;
}
