/**
 * Reading a PDF's text layer, using the pdf.js Obsidian already has.
 *
 * Obsidian ships pdf.js for its own viewer and hands it over through
 * `loadPdfJs()`. Borrowing it rather than bundling a second copy is not a
 * nicety: pdf.js is larger than this entire plugin, and `scripts/check-bundle`
 * would refuse the build. Nothing here is imported at load time either — the
 * reader is asked for only when someone runs the command.
 *
 * This is the one module that knows what pdf.js looks like. It turns a
 * document into the plain runs `services/pdf-passages` works on, so every
 * decision about what a passage is stays testable without a PDF.
 */

import { loadPdfJs } from "obsidian";
import type { PdfPageRuns, PdfTextRun } from "../services/pdf-passages";
import {
  marksBothWays,
  toMark,
  toPlacedRun,
  type PdfMark,
  type PdfMarkedPage,
  type PdfPlacedRun
} from "../services/pdf-highlights";

/**
 * How many pages are read before the reader stops.
 *
 * A textbook is a plausible thing to attach, and reading a thousand pages
 * blocks the interface for as long as it takes. The cap is high enough that
 * no report reaches it and low enough that no vault freezes; when it is hit
 * the caller is told, rather than quietly shown the first part as if it were
 * the whole.
 */
export const MAX_PAGES_READ = 200;

export interface ReadResult {
  pages: PdfPageRuns[];
  /** Pages the document has, which may exceed what was read. */
  totalPages: number;
  /** Whether {@link MAX_PAGES_READ} stopped the reading short. */
  truncated: boolean;
}

/** The shape this module needs from pdf.js, named so the casts stay in one place. */
interface TextContentItem {
  str?: unknown;
  hasEOL?: unknown;
}

function toRun(item: TextContentItem): PdfTextRun | null {
  if (typeof item.str !== "string") return null;
  return { text: item.str, endsLine: item.hasEOL === true };
}

/**
 * Read the text layer of `data`, page by page.
 *
 * A page whose text cannot be read does not end the reading: a single
 * malformed page in a long report should cost that page, not the command.
 * It contributes no runs, which makes it indistinguishable from a page of
 * pictures — correct, because to a reader looking for text it is one.
 */
export function readPdfText(data: ArrayBuffer): Promise<ReadResult> {
  return readPages(data, async (document, number) => ({
    page: number,
    runs: await runsOfPage(document, number)
  }));
}

export interface MarkedReadResult {
  pages: PdfMarkedPage[];
  totalPages: number;
  truncated: boolean;
}

/**
 * Read the highlights and underlines of `data`, and the text layer, with each
 * run's place, of the pages that have both.
 *
 * As with the plain reading, a page that cannot be read costs that page: it
 * comes back with no runs and no marks, and the excerpt simply has nothing
 * from it.
 */
export function readPdfMarks(data: ArrayBuffer): Promise<MarkedReadResult> {
  return readPages(data, (document, number) => markedPage(document, number));
}

async function readPages<Page>(
  data: ArrayBuffer,
  readPage: (document: unknown, number: number) => Promise<Page>
): Promise<{ pages: Page[]; totalPages: number; truncated: boolean }> {
  const pdfjs = await loadPdfJs();
  const document = await pdfjs.getDocument({ data }).promise;

  try {
    const totalPages: number = document.numPages;
    const readable = Math.min(totalPages, MAX_PAGES_READ);
    const pages: Page[] = [];

    for (let number = 1; number <= readable; number += 1) {
      pages.push(await readPage(document, number));
    }

    return { pages, totalPages, truncated: totalPages > readable };
  } finally {
    // pdf.js holds a worker per document; a command that ran and returned
    // should not leave one behind.
    await document.destroy?.();
  }
}

interface PdfJsPage {
  getTextContent(): Promise<{ items?: unknown }>;
  getAnnotations?: () => Promise<unknown>;
  cleanup?: () => void;
}

async function markedPage(document: unknown, number: number): Promise<PdfMarkedPage> {
  try {
    const doc = document as { getPage(n: number): Promise<unknown> };
    const page = (await doc.getPage(number)) as PdfJsPage;
    const annotations = (await page.getAnnotations?.()) ?? [];
    const marks = (Array.isArray(annotations) ? annotations : [])
      .map(toMark)
      .filter((mark): mark is PdfMark => mark !== null);
    // The text layer is the expensive part, and only a page marked both ways
    // can give anything; every other page is left unread.
    let runs: PdfPlacedRun[] = [];
    if (marksBothWays(marks)) {
      const content = await page.getTextContent();
      const items: unknown[] = Array.isArray(content.items) ? content.items : [];
      runs = items.map(toPlacedRun).filter((run) => run !== null);
    }
    page.cleanup?.();
    return { page: number, runs, marks };
  } catch {
    return { page: number, runs: [], marks: [] };
  }
}

async function runsOfPage(document: unknown, number: number): Promise<PdfTextRun[]> {
  try {
    const doc = document as { getPage(n: number): Promise<unknown> };
    const page = (await doc.getPage(number)) as {
      getTextContent(): Promise<{ items?: unknown }>;
      cleanup?: () => void;
    };
    const content = await page.getTextContent();
    const items = Array.isArray(content.items) ? (content.items as TextContentItem[]) : [];
    const runs = items.map(toRun).filter((run): run is PdfTextRun => run !== null);
    page.cleanup?.();
    return runs;
  } catch {
    return [];
  }
}
