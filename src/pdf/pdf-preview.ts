/**
 * Drawing a PDF's pages into the print dialog, using the pdf.js Obsidian has.
 *
 * The same borrowing as `pdf-reader.ts`, for the same reason: pdf.js is larger
 * than this plugin, and Obsidian ships it on every platform for its own
 * viewer. What the preview shows is the document that will be written, drawn
 * by the viewer that will later open it — not an imitation of either.
 *
 * Every page is in the preview, but only the pages near the view are drawn:
 * each stands as a placeholder of its own size until it scrolls close, and
 * lets its picture go again once enough others have been drawn since
 * (`services/preview-pages.ts`). A sixty-slide deck scrolls from end to end
 * while holding a handful of pictures, where drawing every page up front held
 * one per page — the reason the preview used to stop at twelve.
 */
import { loadPdfJs } from "obsidian";
import { PREVIEW_FIRST_PAGES, pagesToRelease } from "../services/preview-pages";
import { isElementLike } from "../services/workspace-internals";

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

/** A line the dialog draws over a page: a break a person set, or where one would go. */
export interface PreviewMark {
  page: number;
  /** Points from the page's top, as the typesetter measures. */
  y: number;
  kind: "break" | "guide";
  label: string;
}

/** A preview on the panel: open until the next one replaces it, or the dialog closes. */
export class PdfPreview {
  private readonly slots: HTMLElement[] = [];
  /** A layer over each page for the dialog's marks, kept while its picture comes and goes. */
  private readonly layers: HTMLElement[] = [];
  /** Each page's size in points once drawn; the first page's stands in until then. */
  private readonly sizes: ({ width: number; height: number } | undefined)[] = [];
  private firstSize = { width: 1, height: 1 };
  private readonly drawn: number[] = [];
  private readonly near = new Set<number>();
  private observer: IntersectionObserver | null = null;
  private drawing: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(
    private readonly document: PdfDocument,
    private readonly width: number
  ) {}

  get pages(): number {
    return this.document.numPages;
  }

  /**
   * Show the document in `into`, each page `width` CSS pixels wide, replacing
   * what was there once its first pages are drawn. Null when `stale` says a
   * newer preview has started meanwhile; nothing is shown then.
   */
  static async open(
    pdf: Uint8Array,
    into: HTMLElement,
    width: number,
    stale: () => boolean
  ): Promise<PdfPreview | null> {
    const pdfjs = await loadPdfJs();
    // pdf.js takes ownership of the buffer it is given; a copy keeps the bytes
    // the dialog may still write to the vault intact.
    const document = (await pdfjs.getDocument({ data: pdf.slice() }).promise) as PdfDocument;
    const preview = new PdfPreview(document, width);
    try {
      // Every placeholder takes the first page's proportions until its own
      // page is drawn: a deck's pages are all one size, and a document's
      // nearly always.
      const first = (await document.getPage(1)).getViewport({ scale: 1 });
      preview.firstSize = { width: first.width, height: first.height };
      for (let number = 1; number <= document.numPages; number += 1) {
        const slot = createDiv({ cls: "schreibstube-print-page-slot" });
        slot.style.width = `${width}px`;
        slot.style.aspectRatio = `${first.width} / ${first.height}`;
        preview.layers.push(slot.createDiv({ cls: "schreibstube-print-page-marks" }));
        preview.slots.push(slot);
      }
      for (
        let number = 1;
        number <= Math.min(PREVIEW_FIRST_PAGES, document.numPages);
        number += 1
      ) {
        if (stale()) break;
        await preview.draw(number);
      }
    } catch (error) {
      await preview.close();
      throw error;
    }
    if (stale()) {
      await preview.close();
      return null;
    }
    into.replaceChildren(...preview.slots);
    preview.watch(into);
    return preview;
  }

  /**
   * The page a point on the screen is on, and its height there in points from
   * the page's top — Typst's own unit, so it compares with where the
   * typesetter said each block starts. Null when the point is on no page.
   */
  pointAt(clientY: number, target: EventTarget | null): { page: number; y: number } | null {
    const slot = isElementLike(target) ? target.closest(".schreibstube-print-page-slot") : null;
    const index = isElementLike(slot) ? this.slots.indexOf(slot) : -1;
    if (!slot || index === -1) return null;
    // The slot as it stands on screen, which CSS may have made narrower than
    // the width it was given.
    const rect = slot.getBoundingClientRect();
    if (rect.height <= 0) return null;
    const size = this.sizes[index] ?? this.firstSize;
    return { page: index + 1, y: ((clientY - rect.top) / rect.height) * size.height };
  }

  /** Draw these marks over the pages, in place of the ones drawn before. */
  showMarks(marks: readonly PreviewMark[]): void {
    for (const layer of this.layers) layer.empty();
    for (const mark of marks) {
      const layer = this.layers[mark.page - 1];
      if (!layer) continue;
      const size = this.sizes[mark.page - 1] ?? this.firstSize;
      const line = layer.createDiv({ cls: `schreibstube-print-break-line is-${mark.kind}` });
      line.style.top = `${Math.min(100, Math.max(0, (mark.y / size.height) * 100))}%`;
      line.createSpan({ cls: "schreibstube-print-break-label", text: mark.label });
    }
  }

  /** Let every picture and the document go. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.observer?.disconnect();
    for (const page of [...this.drawn]) this.release(page);
    await this.drawing.catch(() => undefined);
    await this.document.destroy?.();
  }

  /** Draw what comes within a screen of the view, and let go of what is far. */
  private watch(scroller: HTMLElement): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = this.slots.indexOf(entry.target as HTMLElement) + 1;
          if (page === 0) continue;
          if (entry.isIntersecting) this.near.add(page);
          else this.near.delete(page);
        }
        for (const page of [...this.near].sort((a, b) => a - b)) {
          if (!this.drawn.includes(page)) this.queue(page);
        }
      },
      { root: scroller, rootMargin: "100% 0px" }
    );
    for (const slot of this.slots) this.observer.observe(slot);
  }

  /** One page at a time: pdf.js drawing two canvases at once gains nothing. */
  private queue(page: number): void {
    this.drawing = this.drawing
      .then(async () => {
        if (this.closed || this.drawn.includes(page) || !this.near.has(page)) return;
        await this.draw(page);
        for (const far of pagesToRelease(this.drawn, this.near)) this.release(far);
      })
      .catch(() => undefined);
  }

  private async draw(number: number): Promise<void> {
    const slot = this.slots[number - 1];
    if (!slot) return;
    const page = await this.document.getPage(number);
    const natural = page.getViewport({ scale: 1 });
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (this.width / natural.width) * ratio });

    const canvas = createEl("canvas", { cls: "schreibstube-print-page" });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${this.width}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    await page.render({ canvasContext: context, viewport }).promise;
    if (this.closed) {
      canvas.width = 0;
      return;
    }
    slot.style.aspectRatio = `${natural.width} / ${natural.height}`;
    this.sizes[number - 1] = { width: natural.width, height: natural.height };
    const layer = this.layers[number - 1];
    slot.replaceChildren(...(layer ? [canvas, layer] : [canvas]));
    this.drawn.push(number);
  }

  private release(number: number): void {
    const slot = this.slots[number - 1];
    const canvas = slot?.querySelector("canvas");
    // A canvas keeps its pixels until it is resized or collected; setting its
    // width frees them now rather than whenever the collector gets round to it.
    if (canvas) canvas.width = 0;
    const layer = this.layers[number - 1];
    slot?.replaceChildren(...(layer ? [layer] : []));
    const at = this.drawn.indexOf(number);
    if (at !== -1) this.drawn.splice(at, 1);
  }
}
