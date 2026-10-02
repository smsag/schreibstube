/**
 * Printing a passage of a note rather than all of it.
 *
 * A CV kept in a long application, one chapter of a manuscript: the passage
 * is marked in the editor and printed on its own, with the note's template
 * and properties. Two things change against a whole note. The PDF needs a
 * name of its own, or printing the CV would silently replace the PDF of the
 * whole note beside it; that name is decided here. And footnotes and
 * reference links are defined anywhere in a note, so a passage that uses one
 * defined further down would print it empty unless the note's definitions
 * come along, which the converter's `definitionsFrom` sees to.
 */
import { fencedLines } from "./markdown-fence";

/** The longest part of a PDF's name a passage's heading may take. */
export const MAX_PASSAGE_TITLE_CHARS = 60;

/**
 * Characters a vault file name may not carry, or that Obsidian reads as part
 * of a link: a heading such as "Lebenslauf: 2026/27" becomes "Lebenslauf 2026 27".
 */
const UNSAFE_IN_NAME = /[\\/:*?"<>|#^[\]]/g;

/**
 * The PDF's name for a passage, without `.pdf`: the note's name and the
 * passage's first heading, or the word for a selection when it has none or
 * the heading is the note's own name again.
 */
export function passageFileName(basename: string, passage: string, fallback: string): string {
  const heading = firstHeading(passage);
  const title = heading === null ? "" : nameSafe(heading);
  const named = title !== "" && title !== basename ? title : fallback;
  return `${basename} – ${named}`;
}

/** The first heading of any level outside a fenced block, as written. */
function firstHeading(passage: string): string | null {
  const lines = passage.split(/\r?\n/);
  const fenced = fencedLines(lines);
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue;
    const match = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/** A heading as a file name: markup and unsafe characters out, spaces folded, length capped. */
function nameSafe(heading: string): string {
  const plain = heading
    // A link reads as its text, an embed or a wikilink as what it shows.
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`=]/g, "")
    .replace(UNSAFE_IN_NAME, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= MAX_PASSAGE_TITLE_CHARS) return plain;
  return plain.slice(0, MAX_PASSAGE_TITLE_CHARS).trimEnd();
}
