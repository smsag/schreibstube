/**
 * Which icon a row in the file pane draws when nobody chose one.
 *
 * A decision, so it lives here rather than in the view: the pane asks, and
 * the answer can be tested without a vault.
 */

/** Attachments drawn as a picture rather than a blank sheet. */
const MEDIA_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "mp4",
  "mov",
  "webm",
  "mkv",
  "mp3",
  "m4a",
  "ogg",
  "wav",
  "flac"
]);

export type GlyphSubject =
  | { kind: "folder"; open: boolean }
  | { kind: "file"; extension: string }
  /** Something the vault lists that is neither, which Obsidian does not
   *  produce today but the type allows. */
  | { kind: "other" };

/**
 * The icon for a row: the one chosen for it, or the one its kind implies.
 *
 * A vault's attachments are mostly pictures and recordings, and a row of
 * identical blank sheets says nothing about which is which.
 */
export function fileGlyph(chosen: string | null | undefined, subject: GlyphSubject): string {
  if (chosen) return chosen;

  if (subject.kind === "folder") return subject.open ? "folder-open" : "folder";
  if (subject.kind === "other") return "file";

  const extension = subject.extension.toLowerCase();
  if (extension === "md") return "file-text";
  if (MEDIA_EXTENSIONS.has(extension)) return "photo";
  return "file";
}
