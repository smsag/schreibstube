/**
 * The note the marked text of a PDF goes into.
 *
 * The note is made from a template the person keeps — a reading note with
 * its frontmatter, its headings, its place for the excerpt — so nothing about
 * its shape is decided here except where the two things this feature brings
 * go: the excerpt, and a link to the PDF it came from. Each has a
 * placeholder the template puts where it wants it.
 *
 * The template's own variables are filled the way Obsidian's core Templates
 * plugin fills them, in the formats it is set to, so a template that already
 * works with "Insert template" works here unchanged. Templater code is not
 * run here; the controller has Templater make the note from the template
 * first, and only then is it filled here, so that nothing from the PDF is
 * ever in front of Templater.
 *
 * That last point needs more than order. Templater's "trigger on new file
 * creation" runs the code in every note that appears, a moment after it
 * does, so the PDF's text and its file name are escaped here as foreign text
 * is everywhere else, `<%` included: once in the note, they show and do
 * nothing.
 */

import { normalizeVaultFolder } from "./file-name";
import { escapeForeignText, foreignLine } from "./foreign-text";

/** Where the running text of the marked passages goes. */
export const HIGHLIGHTS_PLACEHOLDER = "{{schreibstube-highlights}}";
/** Where the link to the PDF goes, as an embed. */
export const PDF_PLACEHOLDER = "{{schreibstube-pdf}}";

/**
 * The excerpt made safe to sit in a note as prose: escaped as foreign text,
 * and kept from starting a heading, a quote or a list when the placeholder
 * stands at the start of a line. A list number keeps its digits and has its
 * dot escaped, which is the escape Markdown honours.
 */
export function escapeExcerpt(text: string): string {
  return escapeForeignText(text)
    .replace(/^(\s*)([#>+*-])/, "$1\\$2")
    .replace(/^(\s*)(\d+)([.)])/, "$1$2\\$3");
}

/**
 * The embed of the PDF, unless its name could act in the note.
 *
 * A link cannot be escaped without breaking it, and a PDF called
 * `<% … %>.pdf` is a legal file name that Templater would run. So a name with
 * Templater's opener, or with `%%`, which hides the rest of the note, is
 * written as its name and not linked.
 */
export function safeEmbed(embed: string, pdfName: string): string {
  return /<%|%%/.test(embed) ? foreignLine(pdfName) : embed;
}

/** What the note is filled with. */
export interface HighlightNoteParts {
  /** The running text, not yet escaped. */
  excerpt: string;
  /** The embed of the PDF, as Obsidian generated it for the new note, already checked. */
  pdfEmbed: string;
  /** The new note's name, for `{{title}}`; escaped here. */
  title: string;
  /** The current date or time in a format of the kind the core plugin takes. */
  formatNow: (format: string) => string;
  /** The core Templates plugin's formats for a bare `{{date}}` and `{{time}}`. */
  dateFormat: string;
  timeFormat: string;
}

const FILLED =
  /\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}|\{\{schreibstube-(highlights|pdf)\}\}/gi;

/**
 * The note's text from the template.
 *
 * The core variables and both placeholders are replaced in one pass, so
 * nothing that went in — a PDF whose text or name happens to hold `{{date}}`
 * or a placeholder — is read again. A template without a place for the
 * excerpt still gets it, at the end: the person ran the command to have the
 * text, and a note without it would look like a failure. A template without a
 * place for the PDF does not get the embed, since leaving it out may be the
 * template's intention. With no template at all, the note is the excerpt and
 * the embed.
 */
export function composeHighlightNote(template: string | null, parts: HighlightNoteParts): string {
  const excerpt = escapeExcerpt(parts.excerpt);
  if (template === null || template.trim() === "") return `${excerpt}\n\n${parts.pdfEmbed}\n`;

  let placed = 0;
  const filled = template.replace(
    FILLED,
    (_match, name: string | undefined, format: string | undefined, ours: string | undefined) => {
      if (ours === "highlights") {
        placed += 1;
        return excerpt;
      }
      if (ours === "pdf") return parts.pdfEmbed;
      const kind = (name ?? "").toLowerCase();
      if (kind === "title") return foreignLine(parts.title);
      const fallback = kind === "date" ? parts.dateFormat : parts.timeFormat;
      return parts.formatNow(format?.trim() || fallback);
    }
  );
  if (placed > 0) return filled;
  return `${filled.replace(/\s*$/, "")}\n\n${excerpt}\n`;
}

/**
 * A template setting as a vault path to a note: `.md` added when it was left
 * off, as a person types the name they see. Empty means no template.
 */
export function templateNotePath(setting: string): string {
  const trimmed = setting.trim();
  if (trimmed === "") return "";
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

/**
 * The template setting as typed, as a vault path, or null when it cannot be
 * one. A backslash is read as the folder separator Windows shows; anything
 * else `normalizeVaultFolder` refuses — a folder starting with a dot, an
 * empty segment — is refused here too, for the caller to say so.
 */
export function normalizeTemplatePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return normalizeVaultFolder(value.replace(/\\/g, "/"));
}
