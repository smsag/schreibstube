/**
 * A note as a deck of slides.
 *
 * A template that says `schreibstubeSlides: true` is printed one slide to a
 * page, and the note's own outline decides where one ends: a heading of level
 * one or two starts a slide and is its title, a horizontal rule starts an
 * untitled one that carries on. Inside a slide, each `###` heading opens a
 * column and titles it, and the slide has as many columns as it has such
 * headings: two make two, three make three. A fourth starts a second row
 * rather than a fourth, narrower column. Deeper headings are ordinary
 * headings inside the column they fall in.
 *
 * A first-level heading with nothing under it before the next slide is a
 * section divider — and when it opens the deck, the title slide.
 *
 * Every block of a slide stands centred across the page unless the print
 * asks for the left edge. The choice moves blocks, not lines: a centred
 * paragraph is placed in the middle as a whole and its lines stay flush left.
 * It reaches the slide as its `horizontal` argument, a Typst alignment, so a
 * template's own slide receives it too.
 *
 * Only the grouping is decided here. How a slide looks, and how it shrinks
 * when it holds more than fits, is the prelude's `schreibstube-slide`, which
 * a template may replace.
 */
import { typstString } from "./typst-value";

/** One top-level piece of the converted note, as the converter hands it over. */
export type SlidePart =
  | { kind: "block"; markup: string }
  /** `markup` is the heading's text as inline Typst, without the `=` marks. */
  | { kind: "heading"; level: number; markup: string }
  | { kind: "break" };

export type SlideKind = "title" | "section" | "content";

/** Where a slide's content stands across the page. */
export type SlideAlign = "center" | "left";

export const SLIDE_ALIGNS: readonly SlideAlign[] = ["center", "left"];

export interface SlideColumn {
  /** The column heading as inline Typst. */
  title: string;
  body: string[];
}

export interface Slide {
  kind: SlideKind;
  /** The level of the heading that opened it: 1, 2, or 0 when none did. */
  level: number;
  /** The title as inline Typst, or null for a slide no heading opened. */
  title: string | null;
  /** What stands above the columns, or the whole body when there are none. */
  intro: string[];
  /** One per `###` heading, at least one and at most `MAX_SLIDE_COLUMNS`. */
  columns: number;
  cells: SlideColumn[];
}

/** The heading level that opens a column. */
export const COLUMN_LEVEL = 3;

/** Columns side by side before the next ones start a row of their own. */
export const MAX_SLIDE_COLUMNS = 3;

/** The heading levels that start a slide. */
const SLIDE_LEVELS = new Set([1, 2]);

export function groupSlides(parts: readonly SlidePart[]): Slide[] {
  const slides: Slide[] = [];
  let current: Slide | null = null;

  const open = (level: number, title: string | null): Slide => {
    const slide: Slide = { kind: "content", level, title, intro: [], columns: 1, cells: [] };
    slides.push(slide);
    return slide;
  };
  const place = (markup: string): void => {
    const slide = current ?? (current = open(0, null));
    const last = slide.cells[slide.cells.length - 1];
    if (last) last.body.push(markup);
    else slide.intro.push(markup);
  };

  for (const part of parts) {
    if (part.kind === "break") {
      current = null;
      continue;
    }
    if (part.kind === "block") {
      place(part.markup);
      continue;
    }
    if (SLIDE_LEVELS.has(part.level)) {
      current = open(part.level, part.markup);
      continue;
    }
    if (part.level === COLUMN_LEVEL) {
      const slide = current ?? (current = open(0, null));
      slide.cells.push({ title: part.markup, body: [] });
      slide.columns = Math.min(slide.cells.length, MAX_SLIDE_COLUMNS);
      continue;
    }
    place(`${"=".repeat(part.level)} ${part.markup}\n`);
  }

  // A rule with nothing after it before the next slide leaves nothing to show.
  const kept = slides.filter((slide) => !isEmpty(slide) || slide.title !== null);
  kept.forEach((slide, index) => {
    if (slide.level === 1 && isEmpty(slide)) slide.kind = index === 0 ? "title" : "section";
  });
  return kept;
}

function isEmpty(slide: Slide): boolean {
  return slide.intro.length === 0 && slide.cells.length === 0;
}

/**
 * The deck as the body of a document: one `#schreibstube-slide` call per
 * slide. Every piece arrives as content in brackets, which the converter's
 * escaping keeps balanced.
 */
export function slidesMarkup(slides: readonly Slide[], align: SlideAlign = "center"): string {
  return slides
    .map((slide) => {
      const cells = slide.cells
        .map((cell) => `(${content(cell.title)}, ${content(blocks(cell.body))}),`)
        .join(" ");
      return (
        `#schreibstube-slide(\n` +
        `  kind: ${typstString(slide.kind)},\n` +
        `  level: ${slide.level},\n` +
        `  horizontal: ${align},\n` +
        `  title: ${slide.title === null ? "none" : content(slide.title)},\n` +
        `  columns: ${slide.columns},\n` +
        `  intro: ${content(blocks(slide.intro))},\n` +
        `  cells: (${cells}),\n` +
        `)\n`
      );
    })
    .join("\n");
}

/**
 * Each block of a slide handed to `#schreibstube-slide-block`, which places it
 * by the slide's alignment and keeps its own lines flush left: centred, a
 * paragraph stands in the middle as a whole and still reads like text.
 */
function blocks(markups: readonly string[]): string {
  return markups.map((markup) => `#schreibstube-slide-block[\n${markup.trim()}\n]`).join("\n");
}

function content(markup: string): string {
  const text = markup.trim();
  return text === "" ? "[]" : `[\n${text}\n]`;
}

/** A slide the fit made smaller: its page, and the share of its size it kept. */
export interface SlideFit {
  page: number;
  scale: number;
}

/** Below this share of its size a slide's text is hard to read from a seat. */
export const SMALL_SLIDE_SCALE = 0.6;

/** The most fits read from one document: a deck, not a book of slides. */
export const MAX_SLIDE_FITS = 2000;

/** The longest report read at all, before it is parsed. */
export const MAX_FIT_REPORT_CHARS = 256 * 1024;

/**
 * The compiler's report of the slides it made smaller, as the worker hands it
 * over: the JSON of every `<schreibstube-fit>` metadata in the document. It
 * crossed a thread and came out of a template, so it is read as untrusted —
 * anything that is not a page and a share between nought and one is dropped,
 * and a report that is not JSON at all reads as none.
 */
export function readSlideFits(report: unknown): SlideFit[] {
  if (typeof report !== "string" || report.length > MAX_FIT_REPORT_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(report);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const fits: SlideFit[] = [];
  for (const entry of parsed.slice(0, MAX_SLIDE_FITS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { page, scale } = entry as Record<string, unknown>;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) continue;
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 || scale > 1) continue;
    fits.push({ page, scale });
  }
  return fits;
}

/**
 * The slides set too small to read, in page order, each once at the smallest
 * it was set, or null when there are none. A slide shrinks as a whole and
 * never fails, so this is the only word a person gets that one wants
 * splitting.
 */
export function smallSlides(
  fits: readonly SlideFit[],
  threshold: number = SMALL_SLIDE_SCALE
): { pages: number[]; smallest: number } | null {
  const byPage = new Map<number, number>();
  for (const fit of fits) {
    if (fit.scale >= threshold) continue;
    byPage.set(fit.page, Math.min(fit.scale, byPage.get(fit.page) ?? 1));
  }
  if (byPage.size === 0) return null;
  return {
    pages: [...byPage.keys()].sort((a, b) => a - b),
    smallest: Math.min(...byPage.values())
  };
}
