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
export async function readPdfText(data: ArrayBuffer): Promise<ReadResult> {
  const pdfjs = await loadPdfJs();
  const document = await pdfjs.getDocument({ data }).promise;

  try {
    const totalPages: number = document.numPages;
    const readable = Math.min(totalPages, MAX_PAGES_READ);
    const pages: PdfPageRuns[] = [];

    for (let number = 1; number <= readable; number += 1) {
      pages.push({ page: number, runs: await runsOfPage(document, number) });
    }

    return { pages, totalPages, truncated: totalPages > readable };
  } finally {
    // pdf.js holds a worker per document; a command that ran and returned
    // should not leave one behind.
    await document.destroy?.();
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
