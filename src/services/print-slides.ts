/**
 * A note as a deck of slides.
 *
 * A template that says `schreibstubeSlides: true` is printed one slide to a
 * page, and the note's own outline decides where one ends: a heading of level
 * one or two starts a slide and is its title, a horizontal rule starts an
 * untitled one that carries on. Inside a slide, `###` headings open two
 * columns and `####` headings three, each heading the title of its column.
 * Whichever of the two a slide meets first is its column level; a heading of
 * the other is an ordinary heading inside the column it falls in, and a fifth
 * column heading on a slide of three starts a second row rather than a
 * narrower column.
 *
 * A first-level heading with nothing under it before the next slide is a
 * section divider — and when it opens the deck, the title slide.
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
  /** 1 without column headings, 2 under `###`, 3 under `####`. */
  columns: number;
  cells: SlideColumn[];
}

/** How many columns each column heading level lays out. */
export const SLIDE_COLUMNS: Readonly<Record<number, number>> = { 3: 2, 4: 3 };

/** The heading levels that start a slide. */
const SLIDE_LEVELS = new Set([1, 2]);

export function groupSlides(parts: readonly SlidePart[]): Slide[] {
  const slides: Slide[] = [];
  let current: Slide | null = null;
  let columnLevel = 0;

  const open = (level: number, title: string | null): Slide => {
    const slide: Slide = { kind: "content", level, title, intro: [], columns: 1, cells: [] };
    slides.push(slide);
    columnLevel = 0;
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
    const columns = SLIDE_COLUMNS[part.level];
    if (columns !== undefined && (columnLevel === 0 || columnLevel === part.level)) {
      const slide = current ?? (current = open(0, null));
      columnLevel = part.level;
      slide.columns = columns;
      slide.cells.push({ title: part.markup, body: [] });
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
export function slidesMarkup(slides: readonly Slide[]): string {
  return slides
    .map((slide) => {
      const cells = slide.cells
        .map((cell) => `(${content(cell.title)}, ${content(cell.body.join("\n"))}),`)
        .join(" ");
      return (
        `#schreibstube-slide(\n` +
        `  kind: ${typstString(slide.kind)},\n` +
        `  level: ${slide.level},\n` +
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
