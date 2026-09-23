/**
 * A PDF's text, cut into passages a person can choose between.
 *
 * pdf.js hands back one array of text runs per page, in the order the file
 * draws them, with a flag on the runs that end a visual line. That is not
 * prose: a paragraph arrives as a dozen runs, a heading looks like any other
 * run, and the blank runs that stand for vertical space are the only sign of
 * where one thought ends and the next begins.
 *
 * So the runs are grouped into passages on that one signal, and each passage
 * keeps the indices it was built from. Those indices are what addresses it
 * again in `pdf-anchor`, which is why the grouping happens here and not in
 * the view: a passage that lost track of where it came from could be shown
 * but never linked to.
 *
 * Nothing here imports pdf.js. The view reads the document and passes plain
 * runs in, so the rules below can be tested without a PDF.
 */

import type { PdfAnchor } from "./pdf-anchor";

/** One text run as the reader hands it over. */
export interface PdfTextRun {
  text: string;
  /** Whether this run ends a visual line. pdf.js calls this `hasEOL`. */
  endsLine: boolean;
}

/** One page's runs, in the order the file draws them. */
export interface PdfPageRuns {
  /** Physical page, 1-based. */
  page: number;
  runs: PdfTextRun[];
}

/** A passage, and the place in the PDF it can be opened at. */
export interface PdfPassage {
  /** Physical page, 1-based. */
  page: number;
  /** The passage as prose, joined and de-hyphenated for reading. */
  text: string;
  /** Where it sits, for the jump mark. */
  anchor: PdfAnchor;
}

export interface PassageOptions {
  /**
   * Passages shorter than this are dropped.
   *
   * Running heads, folios and stray marks come back as runs of two or three
   * characters, and a list of them buries the prose. The floor is low on
   * purpose: a short real sentence is worth more than a tidy list.
   */
  minCharacters: number;
}

export const DEFAULT_PASSAGE_OPTIONS: PassageOptions = { minCharacters: 24 };

/**
 * Join runs into prose.
 *
 * A run that ends a line needs a space before the next one, because the line
 * break carried that job in the file. A line ending in a hyphen before a
 * lowercase letter is a word split across lines, and is closed up — German
 * breaks words often enough that leaving them would show "Visualisie-rung"
 * in every second passage. A hyphen before anything else is left alone,
 * since that is a real compound rather than a break.
 *
 * This changes the text but never the anchor: the jump mark is built from
 * run indices, not from the joined string, so rewriting for the reader
 * cannot move where the link lands.
 */
export function joinRuns(runs: PdfTextRun[]): string {
  let out = "";
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    if (!run) continue;
    out += run.text;
    if (!run.endsLine) continue;
    if (i === runs.length - 1) continue;

    const next = runs[i + 1]?.text ?? "";
    const hyphenated = /[\p{L}]-$/u.test(out) && /^[\p{Ll}]/u.test(next);
    if (hyphenated) {
      out = out.slice(0, -1);
    } else if (!/\s$/.test(out) && next !== "") {
      out += " ";
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Cut one page's runs into passages.
 *
 * A blank run ends the passage it follows. Everything else accumulates. The
 * first and last run of a passage give the anchor its indices; the offsets
 * are the whole of those runs, because a passage begins and ends where its
 * runs do.
 */
function passagesOfPage(page: PdfPageRuns, options: PassageOptions): PdfPassage[] {
  const passages: PdfPassage[] = [];
  let startIndex: number | null = null;
  let endIndex = 0;
  let collected: PdfTextRun[] = [];

  const flush = (): void => {
    if (startIndex === null) return;
    const text = joinRuns(collected);
    const lastRun = page.runs[endIndex];
    if (text.length >= options.minCharacters && lastRun) {
      passages.push({
        page: page.page,
        text,
        anchor: {
          page: page.page,
          selection: {
            beginIndex: startIndex,
            beginOffset: 0,
            endIndex,
            endOffset: lastRun.text.length
          }
        }
      });
    }
    startIndex = null;
    collected = [];
  };

  for (let i = 0; i < page.runs.length; i += 1) {
    const run = page.runs[i];
    if (!run) continue;
    if (run.text.trim() === "") {
      flush();
      continue;
    }
    if (startIndex === null) startIndex = i;
    endIndex = i;
    collected.push(run);
  }
  flush();

  return passages;
}

/**
 * Every passage in a document, page by page.
 *
 * Pages are kept in order and pages with no prose simply contribute nothing,
 * so a document of scans comes back empty rather than as a list of noise —
 * which is the signal the caller needs to say there is no text layer here.
 */
export function collectPassages(
  pages: PdfPageRuns[],
  options: PassageOptions = DEFAULT_PASSAGE_OPTIONS
): PdfPassage[] {
  return pages.flatMap((page) => passagesOfPage(page, options));
}
