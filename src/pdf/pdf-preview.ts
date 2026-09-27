/**
 * Drawing a PDF's pages into the print dialog, using the pdf.js Obsidian has.
 *
 * The same borrowing as `pdf-reader.ts`, for the same reason: pdf.js is larger
 * than this plugin, and Obsidian ships it on every platform for its own
 * viewer. What the preview shows is the document that will be written, drawn
 * by the viewer that will later open it — not an imitation of either.
 */
import { loadPdfJs } from "obsidian";

/**
 * How many pages the preview draws.
 *
 * Enough to judge margins, breaks and the look of a page; a book-length note
 * would otherwise spend the wait on pages nobody scrolls to. The rest is
 * counted, so the preview never pretends to be the whole document.
 */
export const MAX_PREVIEW_PAGES = 12;

interface PdfPage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
}

interface PdfDocument {
  numPages: number;
  getPage(number: number): Promise<PdfPage>;
  destroy?: () => Promise<void>;
}

/**
 * Draw the document's first pages, each as wide as `width` CSS pixels, into
 * `into`, replacing what was there. Answers how many pages the document has.
 *
 * `stale` is asked between pages: a newer preview has started, and this one
 * stops rather than draw pages nobody will see.
 */
export async function drawPdfPages(
  pdf: Uint8Array,
  into: HTMLElement,
  width: number,
  stale: () => boolean
): Promise<number> {
  const pdfjs = await loadPdfJs();
  // pdf.js takes ownership of the buffer it is given; a copy keeps the bytes
  // the dialog may still write to the vault intact.
  const document = (await pdfjs.getDocument({ data: pdf.slice() }).promise) as PdfDocument;

  try {
    const pages: HTMLCanvasElement[] = [];
    const count = Math.min(document.numPages, MAX_PREVIEW_PAGES);
    const ratio = window.devicePixelRatio || 1;

    for (let number = 1; number <= count; number += 1) {
      if (stale()) return document.numPages;
      const page = await document.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / natural.width) * ratio });

      const canvas = createEl("canvas", { cls: "schreibstube-print-page" });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${width}px`;
      const context = canvas.getContext("2d");
      if (!context) continue;
      await page.render({ canvasContext: context, viewport }).promise;
      pages.push(canvas);
    }

    if (!stale()) into.replaceChildren(...pages);
    return document.numPages;
  } finally {
    await document.destroy?.();
  }
}
