/**
 * The values a template prints that are not in the note's body.
 *
 * A letter needs a sender, a recipient, a subject and a date; a CV needs a
 * name and a way to be reached. None of that is prose, so none of it belongs
 * in the body — it is said in frontmatter, which is where a vault already
 * keeps what a note is rather than what it says.
 *
 * Three sources, in one order, so that "who is writing" is stated once in the
 * template and "who is being written to" once in the note.
 */
import type { Locale } from "../i18n";
import { fencedLines } from "./markdown-fence";
import type { PrintTemplate } from "./print-template";

/** The frontmatter key a note puts its print data under. */
export const NOTE_DATA_KEY = "schreibstubePrint";

/** The frontmatter key a note names its template with. */
export const NOTE_TEMPLATE_KEY = "schreibstubePrintTemplate";

export interface BuiltinContext {
  /** The note's own title: its first heading, or its file name. */
  title: string;
  /** The file's base name, for a template that wants the file rather than the title. */
  noteName: string;
  now: Date;
  locale: Locale;
}

/**
 * Resolve every value a template may read.
 *
 * The note wins over the template, and both win over the built-ins: a note
 * that says `date` means that date, and a template that says `date` means a
 * fixed one. Values are text by the time they get here, because a template
 * prints them and printing a nested map is not a thing a person asked for.
 */
export function resolvePrintData(
  template: PrintTemplate,
  noteFrontmatter: Readonly<Record<string, unknown>> | null | undefined,
  context: BuiltinContext
): Record<string, string> {
  return {
    ...builtins(context),
    ...template.data,
    ...noteData(noteFrontmatter)
  };
}

/** What the plugin knows without being told. */
function builtins(context: BuiltinContext): Record<string, string> {
  return {
    title: context.title,
    noteName: context.noteName,
    date: formatDate(context.now, context.locale),
    isoDate: isoDate(context.now),
    year: String(context.now.getFullYear())
  };
}

/** The note's own `schreibstubePrint` map, flattened to text. */
function noteData(
  frontmatter: Readonly<Record<string, unknown>> | null | undefined
): Record<string, string> {
  const value = frontmatter?.[NOTE_DATA_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const data: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const text = scalar(entry);
    if (text !== null) data[key] = text;
  }
  return data;
}

/** Which template a note asks for, or null when it asks for none. */
export function templateNameOf(
  frontmatter: Readonly<Record<string, unknown>> | null | undefined
): string | null {
  const value = frontmatter?.[NOTE_TEMPLATE_KEY];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * A date as the language writes it.
 *
 * Formatted by hand rather than by `Intl`, so that the same note prints the
 * same date on a phone whose locale data differs from a laptop's. German puts
 * the day first with dots; English puts the month in words, which is what a
 * letter in English does.
 */
export function formatDate(date: Date, locale: Locale): string {
  const day = date.getDate();
  const month = date.getMonth();
  const year = date.getFullYear();

  if (locale === "de") {
    return `${pad(day)}.${pad(month + 1)}.${year}`;
  }
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  return `${months[month] ?? ""} ${day}, ${year}`;
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A note's title: the first level-one heading, else the file name.
 *
 * The heading wins because a file called `2026-04-12` is a date and the
 * heading inside it is what the document is called.
 */
export function noteTitle(source: string, fallback: string): string {
  const lines = source.split(/\r?\n/);
  const fenced = fencedLines(lines);

  for (const [index, line] of lines.entries()) {
    // A `#` inside a fenced block is a shell comment or a colour, not the
    // document's name: a note that opened with a code block used to print
    // "install deps" as its title.
    if (fenced[index]) continue;
    const match = /^ {0,3}#\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return fallback;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return isoDate(value);
  if (Array.isArray(value)) {
    const parts = value.map(scalar);
    return parts.every((part): part is string => part !== null) ? parts.join("\n") : null;
  }
  return null;
}
