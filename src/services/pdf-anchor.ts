/**
 * The jump mark: a link that opens a PDF where the text came from.
 *
 * Obsidian's own PDF viewer takes a subpath after the file name. Two forms
 * matter here:
 *
 *   Bericht.pdf#page=12
 *   Bericht.pdf#page=12&selection=4,0,6,31
 *
 * `page` is the physical, 1-based page — not the number printed on it, which
 * a document with roman front matter will disagree about. `selection` is four
 * numbers into the page's text-content items: which item the passage starts
 * in and at which character, then the same for where it ends. Those indices
 * are exactly what pdf.js hands back when the text is read, so extracting a
 * passage and addressing it are one act rather than two.
 *
 * The four numbers are also the fragile part. They belong to one file as it
 * was read: re-export the PDF, or replace it with a revision that sets its
 * text in a different order, and the indices still resolve — to the wrong
 * words. That fails quietly, which is worse than failing. So a selection is
 * carried only when it was measured, and every function here degrades to the
 * page alone rather than inventing coordinates. A stale mark then lands on
 * the right page, which is wrong in a way a reader can see and correct.
 */

/** Where a passage sits in a page's text-content items. */
export interface PdfSelection {
  /** Index of the text item the passage starts in. */
  beginIndex: number;
  /** Character offset into that item. */
  beginOffset: number;
  /** Index of the text item the passage ends in. */
  endIndex: number;
  /** Character offset into that item, exclusive. */
  endOffset: number;
}

/** A place in a PDF: always a page, and a selection when one was measured. */
export interface PdfAnchor {
  /** Physical page, 1-based. */
  page: number;
  /** Absent when the passage could not be addressed more precisely than its page. */
  selection?: PdfSelection;
}

function isIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Whether a selection can be trusted to address what it claims.
 *
 * A selection that ends before it starts, or carries a fraction where an item
 * index belongs, is not a near miss to be repaired — it is a sign the numbers
 * did not come from a real reading, and the page alone is the honest answer.
 */
export function isUsableSelection(selection: PdfSelection | undefined): selection is PdfSelection {
  if (!selection) return false;
  const { beginIndex, beginOffset, endIndex, endOffset } = selection;
  if (![beginIndex, beginOffset, endIndex, endOffset].every(isIndex)) return false;
  if (endIndex < beginIndex) return false;
  if (endIndex === beginIndex && endOffset <= beginOffset) return false;
  return true;
}

/**
 * The subpath for an anchor, without the leading `#`.
 *
 * A page below one is not clamped silently: it is the caller's mistake to see,
 * and page 1 is as likely to be wrong as any other guess.
 */
export function pdfSubpath(anchor: PdfAnchor): string {
  if (!Number.isInteger(anchor.page) || anchor.page < 1) {
    throw new Error(`A PDF page is a whole number from 1; received ${anchor.page}.`);
  }
  const page = `page=${anchor.page}`;
  if (!isUsableSelection(anchor.selection)) return page;
  const { beginIndex, beginOffset, endIndex, endOffset } = anchor.selection;
  return `${page}&selection=${beginIndex},${beginOffset},${endIndex},${endOffset}`;
}

/**
 * Read a subpath back into an anchor, or `null` when it addresses no page.
 *
 * Used to tell a mark this plugin wrote from one a person typed, and to leave
 * anything it does not understand alone rather than rewriting it.
 */
export function parsePdfSubpath(subpath: string): PdfAnchor | null {
  const trimmed = subpath.startsWith("#") ? subpath.slice(1) : subpath;
  const parts = new Map<string, string>();
  for (const pair of trimmed.split("&")) {
    const at = pair.indexOf("=");
    if (at > 0) parts.set(pair.slice(0, at), pair.slice(at + 1));
  }

  const page = Number(parts.get("page"));
  if (!Number.isInteger(page) || page < 1) return null;

  const raw = parts.get("selection");
  if (!raw) return { page };

  const numbers = raw.split(",").map(Number);
  if (numbers.length !== 4) return { page };
  const [beginIndex, beginOffset, endIndex, endOffset] = numbers as [
    number,
    number,
    number,
    number
  ];
  const selection = { beginIndex, beginOffset, endIndex, endOffset };
  return isUsableSelection(selection) ? { page, selection } : { page };
}
