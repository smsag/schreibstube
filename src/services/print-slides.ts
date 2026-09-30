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
 * Every slide stands centred across the page unless the print asks for the
 * left edge; the choice reaches the slide as its `horizontal` argument, a
 * Typst alignment, so a template's own slide receives it too.
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
        .map((cell) => `(${content(cell.title)}, ${content(cell.body.join("\n"))}),`)
        .join(" ");
      return (
        `#schreibstube-slide(\n` +
        `  kind: ${typstString(slide.kind)},\n` +
        `  level: ${slide.level},\n` +
        `  horizontal: ${align},\n` +
        `  title: ${slide.title === null ? "none" : content(slide.title)},\n` +
        `  columns: ${slide.columns},\n` +
        `  intro: ${content(slide.intro.join("\n"))},\n` +
        `  cells: (${cells}),\n` +
        `)\n`
      );
    })
    .join("\n");
}

function content(markup: string): string {
  const text = markup.trim();
  return text === "" ? "[]" : `[\n${text}\n]`;
}
