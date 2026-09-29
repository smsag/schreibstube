/**
 * A note's text as a reader sees it, without the machinery around it.
 *
 * Two searches read note bodies: the Explorer filter matches the words in
 * them, and search by meaning embeds them. Both were fed the raw markdown, and
 * both paid for what is not prose. Frontmatter is already searched as fields
 * of its own and, embedded, turns a passage about a kitchen into one about
 * `created: 2024-03-01`. A fenced block of code or a pasted log is hundreds of
 * tokens that describe nothing a person would search for. A URL tokenizes into
 * a dozen fragments, and a pasted image as base64 into thousands — one such
 * line used to cost more model time than the rest of the note.
 *
 * So those are removed and links are reduced to the words they show. Headings
 * and line breaks stay: the chunker cuts at headings, and a word search
 * doesn't care about them.
 *
 * Pure, and bounded by `maxChars` on the way in, so a note of any size costs at
 * most that much to clean.
 */
import { splitFrontmatter } from "./frontmatter-block";

/** How much of one note is read at most. A note longer than this is a book or
 *  an export, and its first two hundred thousand characters already say what
 *  it is about. */
export const MAX_NOTE_CHARS = 200_000;

/** An unbroken run of this many Latin letters, digits and encoding symbols is
 *  a hash, a key or encoded data, never a word. Only those characters: Chinese
 *  or Japanese prose is written without spaces, and a sentence of it is not
 *  data. */
const MAX_WORD_CHARS = 80;

// Any indentation: a fence inside a list item is indented with it, and one
// closed four spaces in used to leave the rest of the note inside the block.
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
// A code span, so what is inside it is not read as markup: `printf("%%d")`
// opened an Obsidian comment that ran to the end of the note.
const CODE_SPAN = /`[^`\n]*`/g;
const OBSIDIAN_COMMENT = /%%[\s\S]*?(?:%%|$)/g;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const EMBED = /!\[\[[^\]\n]*\]\]/g;
const IMAGE = /!\[([^\]\n]*)\]\([^)\n]*\)/g;
const WIKILINK = /\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/g;
const LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;
// Schemes as they are written. Matched case-insensitively, "Data: …" at the
// start of a sentence was taken for one and the sentence dropped.
const URL = /\b(?:https?|obsidian|file|data):[^\s)>\]]+/g;
const LONG_RUN = new RegExp(`[A-Za-z0-9+/=_%.\\-]{${MAX_WORD_CHARS},}`, "g");

/** Drop fenced code blocks, line by line. An unclosed fence runs to the end of
 *  the note, the way Obsidian draws it. */
function withoutFences(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const match = FENCE.exec(line);
    const open = match?.[1];
    const rest = match?.[2] ?? "";
    if (fence === null) {
      // A backtick fence's info string cannot hold a backtick (CommonMark):
      // "```inline``` code" is inline code on a line, not a block that eats
      // the rest of the note.
      if (open && !(open[0] === "`" && rest.includes("`"))) fence = open;
      else out.push(line);
    } else if (open && open[0] === fence[0] && open.length >= fence.length && !rest.trim()) {
      fence = null;
    }
  }
  return out.join("\n");
}

/** The words of a wikilink as the page shows them: the alias when there is one,
 *  otherwise the target without its folder and heading. */
function wikilinkText(_match: string, target: string, alias: string | undefined): string {
  if (alias !== undefined && alias.trim().length > 0) return alias;
  const name = target.split("#")[0]?.split("/").pop() ?? "";
  return name.replace(/\.md$/i, "");
}

/** The prose of a note: see the header for what is removed and why. */
export function plainNoteText(markdown: unknown, maxChars = MAX_NOTE_CHARS): string {
  if (typeof markdown !== "string") return "";
  let text = markdown.slice(0, Math.max(0, maxChars)).replace(/\r\n?/g, "\n");
  text = splitFrontmatter(text).body;
  text = withoutFences(text);
  return text
    .replace(CODE_SPAN, (span) => span.replace(/%%/g, "% %").replace(/<!--/g, "< !--"))
    .replace(OBSIDIAN_COMMENT, " ")
    .replace(HTML_COMMENT, " ")
    .replace(EMBED, " ")
    .replace(IMAGE, "$1")
    .replace(WIKILINK, wikilinkText)
    .replace(LINK, "$1")
    .replace(URL, " ")
    .replace(LONG_RUN, " ")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}
