/**
 * Which icon a row in the file pane draws when nobody chose one, and which
 * part of a file's name the row shows.
 *
 * Decisions, so they live here rather than in the view: the pane asks, and
 * the answers can be tested without a vault.
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
  /** `name` is the whole file name; it tells a drawing from a note. */
  | { kind: "file"; extension: string; name?: string }
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
  if (extension === "pdf") return "file-type-pdf";
  if (extension === "base") return "table";
  if (isDrawing(subject.name ?? "", extension)) return "scribble";
  if (extension === "md") return "file-text";
  if (MEDIA_EXTENSIONS.has(extension)) return "photo";
  return "file";
}

/** The suffix the Excalidraw plugin puts before a drawing's real extension. */
const DRAWING_MARK = ".excalidraw";

/**
 * Whether a file is an Excalidraw drawing: `Name.excalidraw.md` as the plugin
 * saves one today, or `Name.excalidraw` from its older versions. Its exported
 * pictures (`Name.excalidraw.svg`, `.png`) are pictures, not drawings.
 */
export function isDrawing(name: string, extension: string): boolean {
  const ext = extension.toLowerCase();
  if (ext === "excalidraw") return true;
  return ext === "md" && stemOf(name, ext).toLowerCase().endsWith(DRAWING_MARK);
}

/** The extensions whose rows show only the stem; the icon says what they are. */
const HIDDEN_EXTENSIONS = new Set(["md", "svg", "excalidraw", "base"]);

export interface FileNameParts {
  /** What the row shows, and what a rename edits. */
  stem: string;
  /** What the row leaves out, and a rename puts back: `.md`, `.excalidraw.md`, `.svg`. */
  suffix: string;
  /** Whether the row shows the stem alone rather than the whole name. */
  hidden: boolean;
}

/**
 * A file's name split into what the pane shows and what it keeps back.
 *
 * Notes, SVG pictures, Excalidraw drawings and bases show their stem:
 * `Plan.md`, `Plan.svg`, `Plan.excalidraw.md`, `Plan.excalidraw.svg` and
 * `Plan.base` all read `Plan`, and the icon tells them apart. Every other attachment keeps its extension
 * on screen, since `photo.png` beside `photo.jpg` needs it. A rename edits the
 * stem and keeps the suffix either way, so a drawing cannot be renamed out of
 * being one by accident.
 */
export function fileNameParts(name: string, extension: string): FileNameParts {
  const ext = extension.toLowerCase();
  if (ext === "") return { stem: name, suffix: "", hidden: false };

  const base = stemOf(name, ext);
  const hidden = HIDDEN_EXTENSIONS.has(ext);
  const marked =
    (ext === "md" || ext === "svg") &&
    base.toLowerCase().endsWith(DRAWING_MARK) &&
    base.length > DRAWING_MARK.length;
  const stem = marked ? base.slice(0, -DRAWING_MARK.length) : base;

  return { stem, suffix: name.slice(stem.length), hidden };
}

/** The name without `.extension`, as Obsidian's `basename` has it. */
function stemOf(name: string, extension: string): string {
  const suffix = `.${extension}`;
  return name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
