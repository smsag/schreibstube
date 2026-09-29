/**
 * Where a note's frontmatter ends and its body begins.
 *
 * Six places each answered this with their own regular expression, and they
 * disagreed at the edges: one took `...` as a closer and the others did not,
 * one tolerated a space after the fence and the others did not, one could not
 * see an empty block. A note that one feature read as body another read as
 * properties. One answer, with the edges written down.
 *
 * The block opens on a `---` line at the very start of the text and closes on
 * the next `---` or `...` line, either with trailing blanks and either with a
 * Windows line ending. A block that never closes is not one: the whole text
 * is body, which is also how Obsidian reads it.
 */

export interface FrontmatterSplit {
  /** The block with both fence lines and the newline after the closer, or "";
   *  always the exact prefix of the text, so `block + body` is the text. */
  block: string;
  body: string;
}

const OPENER = /^---[ \t]*\r?$/;
const CLOSER = /^(?:---|\.\.\.)[ \t]*\r?$/;

export function splitFrontmatter(text: string): FrontmatterSplit {
  if (!text.startsWith("---")) return { block: "", body: text };

  const lines = text.split("\n");
  if (!OPENER.test(lines[0] ?? "")) return { block: "", body: text };

  for (let i = 1; i < lines.length; i += 1) {
    if (!CLOSER.test(lines[i] ?? "")) continue;
    const closer = lines.slice(0, i + 1).join("\n");
    // A block that ends the note has no newline after it, and counting one
    // would put the body's offset past the end of the text.
    const block = i + 1 < lines.length ? `${closer}\n` : closer;
    return { block, body: text.slice(block.length) };
  }

  return { block: "", body: text };
}
