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

/**
 * How many of the leading `lines` the frontmatter takes, both fences included,
 * or 0 when there is none. For callers that already hold the text as lines;
 * `lines[1 .. count - 2]` is the block's content.
 */
export function frontmatterLineCount(lines: readonly string[]): number {
  if (!OPENER.test(lines[0] ?? "")) return 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (CLOSER.test(lines[i] ?? "")) return i + 1;
  }
  return 0;
}

export function splitFrontmatter(text: string): FrontmatterSplit {
  if (!text.startsWith("---")) return { block: "", body: text };

  const lines = text.split("\n");
  const count = frontmatterLineCount(lines);
  if (count === 0) return { block: "", body: text };

  const closer = lines.slice(0, count).join("\n");
  // A block that ends the note has no newline after it, and counting one
  // would put the body's offset past the end of the text.
  const block = count < lines.length ? `${closer}\n` : closer;
  return { block, body: text.slice(block.length) };
}
