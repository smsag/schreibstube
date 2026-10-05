/**
 * A received mail's files as they land in the vault and in the note.
 *
 * The bridge already chose and named them, but its answer is remote JSON: a
 * name is made safe again here before it becomes a path, and only the kinds
 * the bridge is meant to hand over are written at all.
 */

import { foreignLine } from "./foreign-text";

/** The kinds a note embeds as a picture; the rest are linked. */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic"]);

/** Every kind the bridge hands over, by extension. */
export const IMPORT_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp"
]);

/** Longest name kept, extension aside; the bridge keeps the same. */
export const MAX_ATTACHMENT_NAME_CHARS = 100;

/** Why the bridge left a file out. */
export type SkipReason = "type" | "size" | "limit";

/**
 * A name that is only a name, or null when it has no kind a note may hold:
 * no folder, nothing that breaks a wiki link or a file system, not hidden.
 */
export function safeAttachmentName(name: string): string | null {
  const last = name.split(/[\\/]/).pop() ?? "";
  const match = /\.([a-z0-9]{1,5})$/i.exec(last);
  const extension = match?.[1]?.toLowerCase();
  if (!match || !extension || !IMPORT_EXTENSIONS.has(extension)) return null;

  const base = [...last.slice(0, match.index)]
    .filter((char) => char.charCodeAt(0) > 0x1f && char !== "\u007f")
    .join("")
    .normalize("NFC")
    .replace(/[*"<>:|?#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s]+$/g, "")
    .slice(0, MAX_ATTACHMENT_NAME_CHARS)
    .trim();
  return base ? `${base}.${extension}` : null;
}

/** Whether the file is shown in the note, rather than linked. */
export function isImageAttachment(name: string): boolean {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return extension !== undefined && IMAGE_EXTENSIONS.has(extension);
}

/** Longest name of a file left out that the note repeats, in characters. */
export const MAX_SKIPPED_NAME_CHARS = 120;

/**
 * The lines that follow a quoted mail: its files as embeds and links, and a
 * line naming what was left out, all inside the quote so they read as part of
 * that mail. `links` are the vault's own links to the saved files.
 *
 * The name of a file left out is the sender's, never made safe by being
 * saved, so it is written as foreign text: `![[Finanzen/Gehalt.pdf]].ics`
 * would otherwise be a live embed of a file the sender picked, and a name
 * with a newline in it would end the quote.
 */
export function attachmentQuoteLines(
  links: readonly { link: string; image: boolean }[],
  skipped: readonly { filename: string; reason: string }[],
  skippedLabel: (names: string) => string
): string {
  const lines = links.map(({ link, image }) => `> ${image ? "!" : ""}${link}`);
  if (skipped.length > 0) {
    const names = skipped.map(
      (entry) => `${foreignLine(entry.filename, MAX_SKIPPED_NAME_CHARS)} (${entry.reason})`
    );
    lines.push(`> ${skippedLabel(names.join(", "))}`);
  }
  return lines.length > 0 ? `>\n${lines.join("\n")}` : "";
}
