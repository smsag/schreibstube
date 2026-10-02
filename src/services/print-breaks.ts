/**
 * Page breaks set by pointing at the preview.
 *
 * The preview is a PDF, and a PDF knows nothing of the note it was set from.
 * So the converter puts an invisible mark before every top-level block of the
 * note and asks the typesetter, once the pages are set, where each mark came
 * to stand; the answer crosses back from the worker as JSON. A click is a page
 * and a height on it, and the block it lands in is the last one that starts
 * at or above that point — which, at the top of a page, is the block that ran
 * over from the page before.
 *
 * The marks set nothing: a document with them and one without are the same
 * PDF but for the moment each was made, which the print fixtures check
 * against the real typesetter for every template and case.
 */

/** Where one block starts: its index among the top-level blocks, its page, its height in points from the top. */
export interface BlockPosition {
  block: number;
  page: number;
  y: number;
}

/** The label the converter gives the one report of every block's position. */
export const BLOCK_REPORT_LABEL = "schreibstube-blocks";

/** More blocks than a book has paragraphs; a report past it is not read further. */
export const MAX_BLOCK_POSITIONS = 20_000;

/** The longest report read at all, before it is parsed. */
export const MAX_BLOCK_REPORT_CHARS = 2 * 1024 * 1024;

/**
 * The typesetter's report of where every block starts, as the worker hands it
 * over: the JSON of each `<schreibstube-blocks>` metadata, of which a document
 * has one. It crossed a thread and came out of a compile a template can
 * influence, so it is read as untrusted: anything that is not a whole block
 * index, a page from one and a finite height is dropped, and a report that is
 * not JSON reads as none — the preview is then a preview, and only pointing at
 * it does nothing.
 */
export function readBlockPositions(report: unknown): BlockPosition[] {
  if (typeof report !== "string" || report.length > MAX_BLOCK_REPORT_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(report);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const positions: BlockPosition[] = [];
  for (const value of parsed) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (positions.length >= MAX_BLOCK_POSITIONS) break;
      if (typeof entry !== "object" || entry === null) continue;
      const { block, page, y } = entry as Record<string, unknown>;
      if (typeof block !== "number" || !Number.isInteger(block) || block < 0) continue;
      if (typeof page !== "number" || !Number.isInteger(page) || page < 1) continue;
      if (typeof y !== "number" || !Number.isFinite(y) || y < 0) continue;
      positions.push({ block, page, y });
    }
  }
  return positions.sort((a, b) => a.page - b.page || a.y - b.y || a.block - b.block);
}

/**
 * The block a point on a page lands in: the last one that starts at or above
 * it. Above a page's first block, in the top margin, it depends on what fills
 * the top of the page: a block that ran over from the page before, when the
 * first block starts lower than blocks start at the top of a page, and that
 * first block itself when it starts right at the top — a break set there is
 * taken away by clicking where it shows, not handed to the page before. A
 * point above the document's first block, where something else such as a
 * letterhead opens the first page, is in none.
 */
export function blockAt(
  positions: readonly BlockPosition[],
  page: number,
  y: number
): number | null {
  let found: number | null = null;
  let firstOnPage: BlockPosition | null = null;
  for (const position of positions) {
    if (position.page > page) break;
    if (position.page === page) {
      firstOnPage ??= position;
      if (position.y > y) break;
    }
    found = position.block;
  }
  if (firstOnPage && y < firstOnPage.y && firstOnPage.y <= pageTop(positions) + TOP_SLACK) {
    return firstOnPage.block;
  }
  return found;
}

/** How far below the highest page start a block may begin and still be the top of its page, in points. */
const TOP_SLACK = 2;

/** Where blocks start when they open a page: the highest first block of any page. */
function pageTop(positions: readonly BlockPosition[]): number {
  let top = Infinity;
  let page = 0;
  for (const position of positions) {
    if (position.page === page) continue;
    page = position.page;
    top = Math.min(top, position.y);
  }
  return top;
}

/**
 * The breaks after pointing at a block: one before it when there was none,
 * and none when there was. The first block already starts a page, so a break
 * before it is not one; asking for it changes nothing.
 */
export function toggleBreak(breaks: readonly number[], block: number): number[] {
  if (block <= 0) return [...breaks];
  const next = breaks.includes(block)
    ? breaks.filter((existing) => existing !== block)
    : [...breaks, block];
  return next.sort((a, b) => a - b);
}

/**
 * Where the breaks a person set show on the preview: at the top of the block
 * each one moved, which is now the first thing on its page. A break whose
 * block the report does not have is not drawn.
 */
export function breakMarks(
  positions: readonly BlockPosition[],
  breaks: readonly number[]
): { block: number; page: number; y: number }[] {
  const wanted = new Set(breaks);
  return positions.filter((position) => wanted.has(position.block));
}

/** Where a block starts, to draw where a break before it would go; null when it is not in the report. */
export function blockStart(
  positions: readonly BlockPosition[],
  block: number
): BlockPosition | null {
  return positions.find((position) => position.block === block) ?? null;
}
