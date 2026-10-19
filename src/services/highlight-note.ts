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
 * plugin fills them, so a template that already works with "Insert template"
 * works here unchanged. Templater code is not run here; the controller hands
 * it to Templater, before any text from the PDF is in the note, so that a PDF
 * cannot write code into a template that will run.
 */

import { formatDate } from "./today-value";

/** Where the running text of the marked passages goes. */
export const HIGHLIGHTS_PLACEHOLDER = "{{schreibstube-highlights}}";
/** Where the link to the PDF goes, as an embed. */
export const PDF_PLACEHOLDER = "{{schreibstube-pdf}}";

/** What a template's core variables are filled with. */
export interface TemplateValues {
  /** The new note's name, without `.md`. */
  title: string;
  now: Date;
  locale: string;
}

const CORE_DATE_FORMAT = "YYYY-MM-DD";
const CORE_TIME_FORMAT = "HH:mm";

/**
 * `{{title}}`, `{{date}}` and `{{time}}`, each date and time with an optional
 * `:format`, as the core Templates plugin reads them. Its default formats are
 * used for the bare forms; a template that wants another writes it in.
 */
export function fillCoreVariables(template: string, values: TemplateValues): string {
  return template.replace(
    /\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi,
    (_match, name: string, format: string | undefined) => {
      const kind = name.toLowerCase();
      if (kind === "title") return values.title;
      const fallback = kind === "date" ? CORE_DATE_FORMAT : CORE_TIME_FORMAT;
      const chosen = format?.trim() || fallback;
      return formatDate(values.now, chosen, values.locale);
    }
  );
}

/**
 * The excerpt made safe to sit in a note as prose.
 *
 * It is text from a file somebody sent, and Markdown reads some text as
 * instructions: `<` opens HTML, `[[` and `![[` link and embed, a backtick
 * opens code, and a line that starts with `#`, `>`, `-` or a number and a dot
 * becomes a heading, a quote or a list. Each of those is escaped, so the
 * excerpt reads as it was written and does nothing else. Everything else is
 * left alone: an escaped underscore in every second word would make the
 * note's source unreadable for nothing.
 */
export function escapeExcerpt(text: string): string {
  return text
    .replace(/[\\`<]/g, (character) => `\\${character}`)
    .replace(/\[\[/g, "\\[\\[")
    .replace(/^(\s*)([#>+*-]|\d+[.)])/, "$1\\$2");
}

/** What the note is filled with. */
export interface HighlightNoteParts {
  /** The running text, not yet escaped. */
  excerpt: string;
  /** The embed of the PDF, as Obsidian generated it for the new note. */
  pdfEmbed: string;
}

/**
 * The note's text from the template, its core variables already filled.
 *
 * Both placeholders are replaced in one pass, so a PDF whose text happens to
 * contain a placeholder cannot have it filled in turn. A template without a
 * place for the excerpt still gets it, at the end: the person ran the command
 * to have the text, and a note without it would look like a failure. A
 * template without a place for the PDF does not get the embed, since leaving
 * it out may be the template's intention. With no template at all, the note
 * is the excerpt and the embed.
 */
export function composeHighlightNote(template: string | null, parts: HighlightNoteParts): string {
  const excerpt = escapeExcerpt(parts.excerpt);
  if (template === null || template.trim() === "") return `${excerpt}\n\n${parts.pdfEmbed}\n`;

  const filled = template.replace(/\{\{schreibstube-(highlights|pdf)\}\}/g, (_match, which) =>
    which === "pdf" ? parts.pdfEmbed : excerpt
  );
  if (template.includes(HIGHLIGHTS_PLACEHOLDER)) return filled;
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
