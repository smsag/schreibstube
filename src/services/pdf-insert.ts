/**
 * The Markdown a chosen passage becomes.
 *
 * One passage is one paragraph, and the jump mark sits at the end of it,
 * where a footnote mark would: near enough to belong to the sentence, out of
 * the way of reading it. Several passages keep the order of the document
 * rather than the order they were ticked, because a summary that jumps back
 * and forth through the source is a summary nobody trusts.
 *
 * The link itself is not built here. Whether a vault writes `[[Bericht.pdf]]`
 * or `[Bericht](Bericht.pdf)` is the vault's setting, and Obsidian answers it
 * through an API this layer must not reach for. So the caller passes a
 * renderer and this module decides only where the mark goes.
 */

import type { PdfPassage } from "./pdf-passages";

/** Turns an anchor into whatever link form the vault is set to write. */
export type MarkRenderer = (passage: PdfPassage) => string;

export interface InsertOptions {
  /**
   * Put each passage in a blockquote.
   *
   * Off by default: what goes in is the person's summary of the source, and
   * quoting it claims it is the source's own words.
   */
  quote: boolean;
}

export const DEFAULT_INSERT_OPTIONS: InsertOptions = { quote: false };

/** Document order: by page, then by where the passage sits on it. */
function inDocumentOrder(a: PdfPassage, b: PdfPassage): number {
  if (a.page !== b.page) return a.page - b.page;
  return (a.anchor.selection?.beginIndex ?? 0) - (b.anchor.selection?.beginIndex ?? 0);
}

/**
 * Compose the block to insert, or `""` when nothing was chosen.
 *
 * The empty string is deliberate: a caller that inserts it unconditionally
 * leaves the note exactly as it was, so "chose nothing" needs no special
 * case at the call site.
 */
export function composePassageInsert(
  passages: PdfPassage[],
  renderMark: MarkRenderer,
  options: InsertOptions = DEFAULT_INSERT_OPTIONS
): string {
  if (passages.length === 0) return "";

  return [...passages]
    .sort(inDocumentOrder)
    .map((passage) => {
      const line = `${passage.text} ${renderMark(passage)}`.trim();
      return options.quote ? `> ${line}` : line;
    })
    .join("\n\n");
}
