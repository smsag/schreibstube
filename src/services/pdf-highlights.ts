/**
 * The text a person marked in a PDF, as one running excerpt.
 *
 * A highlight or an underline in a PDF is an annotation: a colour and a set
 * of quadrilaterals on the page, and nothing else. Preview, the iOS
 * Documents app and Acrobat all store it that way, and none of them stores
 * the words underneath. So the words are found again by geometry — every
 * character whose box sits inside a marked quadrilateral counts as marked —
 * and that is the one decision this module makes.
 *
 * It works on characters rather than on annotations, because annotations
 * overlap. A passage underlined and then highlighted is two annotations over
 * the same words, and taking each annotation's text in turn would quote it
 * twice. Marking characters makes the second mark free: a character is
 * marked or it is not.
 *
 * Nothing here imports pdf.js. The reader hands over plain runs with their
 * position and plain marks, read through `toPlacedRun` and `toMark` below, so
 * every rule can be tested without a PDF.
 */

import type { PdfTextRun } from "./pdf-passages";

/** One text run with where pdf.js placed it, in PDF points from the page's bottom left. */
export interface PdfPlacedRun extends PdfTextRun {
  x: number;
  /** The baseline. */
  y: number;
  width: number;
  height: number;
}

/** A rectangle on the page, in the same points as the runs. */
export interface PdfBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A highlight or an underline: its colour and the areas it covers. */
export interface PdfMark {
  kind: "highlight" | "underline";
  /** Red, green and blue, 0–255; null when the file names none. */
  color: [number, number, number] | null;
  boxes: PdfBox[];
}

/** One page as the reader hands it over. */
export interface PdfMarkedPage {
  /** Physical page, 1-based. */
  page: number;
  runs: PdfPlacedRun[];
  marks: PdfMark[];
}

/**
 * Bounds on what one page may bring.
 *
 * A page with a thousand annotations is a form or a machine-made file, not a
 * person reading; past the bound the rest is ignored rather than measured
 * against every character of the page. The quad bound is the same idea for
 * one annotation: a highlight over a whole page of two columns is about a
 * hundred lines.
 */
export const MAX_MARKS_PER_PAGE = 1000;
export const MAX_BOXES_PER_MARK = 400;

/** What goes between two excerpts, as an editor marks an omission. */
export const EXCERPT_SEPARATOR = " […] ";

/**
 * Whether a colour reads as yellow.
 *
 * Every app has its own yellow: Preview writes 250/205/90, others a purer
 * 255/255/0 or a paler one, and a file that went through a second app may
 * come back shifted. So yellow is a range of hue — between orange and green —
 * that is saturated and bright enough not to be beige or olive, rather than
 * one value.
 */
export function isYellow(color: readonly [number, number, number] | null): boolean {
  if (!color) return false;
  const [r, g, b] = color.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (max < 0.6 || chroma / max < 0.3) return false;
  // Yellow sits where red is the largest or green is, so these two branches of
  // the usual hue formula are the only ones that can answer yes.
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / chroma) % 6);
  else if (max === g) hue = 60 * ((b - r) / chroma + 2);
  else return false;
  return hue >= 40 && hue <= 70;
}

/** Whether a mark is one whose words belong in the excerpt: any underline, a yellow highlight. */
export function counts(mark: PdfMark): boolean {
  return mark.kind === "underline" || isYellow(mark.color);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numbers(value: unknown): number[] | null {
  // pdf.js hands over typed arrays for colours and quads; a plain array is
  // what a test or another build may give. Both are read the same way.
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const list = Array.from(value as ArrayLike<unknown>);
  return list.every(finite) ? list : null;
}

/** The boxes in pdf.js's flat quad list: eight numbers, four corners, per box. */
export function quadBoxes(quadPoints: unknown): PdfBox[] {
  const list = numbers(quadPoints);
  if (!list) return [];
  const boxes: PdfBox[] = [];
  for (let i = 0; i + 8 <= list.length && boxes.length < MAX_BOXES_PER_MARK; i += 8) {
    const xs = [list[i], list[i + 2], list[i + 4], list[i + 6]] as number[];
    const ys = [list[i + 1], list[i + 3], list[i + 5], list[i + 7]] as number[];
    boxes.push({
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys)
    });
  }
  return boxes;
}

/**
 * An annotation as pdf.js describes it, read into a mark, or null when it is
 * not a highlight or an underline or carries nothing to measure. The file is
 * whatever the person was sent, so every field is checked rather than
 * trusted.
 */
export function toMark(annotation: unknown): PdfMark | null {
  if (typeof annotation !== "object" || annotation === null) return null;
  const record = annotation as Record<string, unknown>;
  const kind =
    record.subtype === "Highlight"
      ? "highlight"
      : record.subtype === "Underline"
        ? "underline"
        : null;
  if (!kind) return null;

  const boxes = quadBoxes(record.quadPoints);
  if (boxes.length === 0) return null;

  const rgb = numbers(record.color);
  const color =
    rgb && rgb.length >= 3
      ? (rgb.slice(0, 3).map((channel) => Math.min(255, Math.max(0, channel))) as [
          number,
          number,
          number
        ])
      : null;
  return { kind, color, boxes };
}

/**
 * A text item as pdf.js describes it, with its place on the page, or null
 * when it has no text or no position to measure. `transform` is the item's
 * matrix: its last two numbers are where the baseline starts.
 */
export function toPlacedRun(item: unknown): PdfPlacedRun | null {
  if (typeof item !== "object" || item === null) return null;
  const record = item as Record<string, unknown>;
  if (typeof record.str !== "string") return null;
  const matrix = numbers(record.transform);
  const x = matrix?.[4];
  const y = matrix?.[5];
  if (x === undefined || y === undefined) return null;
  const width = finite(record.width) ? Math.max(0, record.width) : 0;
  const scale = matrix?.[3];
  const height = finite(record.height) && record.height > 0 ? record.height : Math.abs(scale ?? 0);
  return { text: record.str, endsLine: record.hasEOL === true, x, y, width, height };
}

/**
 * Whether a box covers a character, given the character's middle and its
 * vertical extent.
 *
 * Across, the middle has to be inside: a mark that stops halfway through a
 * letter has marked the half before it. Up and down, more than half of the
 * smaller of the two has to overlap, because apps disagree on what an
 * underline covers — a thin strip under the baseline in one, the whole line
 * in another — and both have to land on the line they belong to, not the
 * one beneath.
 */
function covers(box: PdfBox, middle: number, bottom: number, top: number): boolean {
  if (middle < box.x0 || middle > box.x1) return false;
  const overlap = Math.min(top, box.y1) - Math.max(bottom, box.y0);
  const smaller = Math.min(top - bottom, box.y1 - box.y0);
  return smaller > 0 ? overlap / smaller > 0.5 : overlap >= 0;
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Which characters of a run are marked, with partly marked words settled.
 *
 * A mark drawn by hand rarely starts and ends on a word boundary: it begins
 * on the second letter, or runs one letter into the next word. A word counts
 * as marked when more than half of its letters are, and then counts whole —
 * "ut" becomes "But", and the stray "I" of a mark that slipped into the next
 * sentence's "In" is left out. Positions are estimated by dividing the run's
 * width evenly among its characters, which proportional type makes rough,
 * and which the word rule then smooths over.
 */
export function markedCharacters(run: PdfPlacedRun, boxes: readonly PdfBox[]): boolean[] {
  const characters = Array.from(run.text);
  const length = characters.length;
  if (length === 0 || boxes.length === 0) return characters.map(() => false);

  const step = run.width / length;
  // A run's height is the font's size, measured up from the baseline; the
  // descenders hang below it, so the extent starts a little lower.
  const bottom = run.y - run.height * 0.2;
  const top = run.y + run.height * 0.8;
  const hit = characters.map((_, index) => {
    const middle = run.x + step * (index + 0.5);
    return boxes.some((box) => covers(box, middle, bottom, top));
  });

  const marked = [...hit];
  let start = 0;
  while (start < length) {
    if (!WORD_CHARACTER.test(characters[start] ?? "")) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < length && WORD_CHARACTER.test(characters[end] ?? "")) end += 1;
    let count = 0;
    for (let index = start; index < end; index += 1) if (hit[index]) count += 1;
    const whole = count * 2 > end - start;
    for (let index = start; index < end; index += 1) marked[index] = whole;
    start = end;
  }
  return marked;
}

/**
 * Join what was collected into prose: a word split across lines closed up,
 * a line break a space, and anything before the first word dropped — a mark
 * that starts on the comma before a clause has not quoted the comma.
 */
function finishExcerpt(raw: string): string {
  return raw
    .replace(/(\p{L})-\n(?=\p{Ll})/gu, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}"'“„‚‘«(]+/u, "")
    .trim();
}

/**
 * The marked text of a document, as excerpts in reading order.
 *
 * The text runs are walked in the order the file draws them, which is the
 * order pdf.js reads them in and, for a book or an article, the order a
 * person reads them in. An excerpt grows as long as marked words follow one
 * another; a word that is not marked ends it. A space or a comma that is not
 * marked does not: it is only what stood between two marked words, and the
 * excerpt keeps it. So two marks that meet are one excerpt, and the gap
 * between two that do not is where the separator goes.
 */
export function collectExcerpts(pages: readonly PdfMarkedPage[]): string[] {
  const excerpts: string[] = [];
  let current = "";
  let pending = "";

  const close = (): void => {
    const text = finishExcerpt(current);
    if (text !== "") excerpts.push(text);
    current = "";
    pending = "";
  };

  for (const page of pages) {
    const boxes = page.marks
      .slice(0, MAX_MARKS_PER_PAGE)
      .filter(counts)
      .flatMap((mark) => mark.boxes);

    for (const run of page.runs) {
      const characters = Array.from(run.text);
      const marked = markedCharacters(run, boxes);
      characters.forEach((character, index) => {
        if (marked[index]) {
          if (current !== "") current += pending;
          current += character;
          pending = "";
        } else if (WORD_CHARACTER.test(character)) {
          if (current !== "") close();
        } else if (current !== "") {
          pending += character;
        }
      });
      if (run.endsLine && current !== "") pending += "\n";
    }
  }
  if (current !== "") close();
  return excerpts;
}

/** How many of a document's marks count toward the excerpt. */
export function countedMarks(pages: readonly PdfMarkedPage[]): number {
  return pages.reduce(
    (sum, page) => sum + page.marks.slice(0, MAX_MARKS_PER_PAGE).filter(counts).length,
    0
  );
}

/** The excerpts as one running text, an omission mark between each two. */
export function runningText(excerpts: readonly string[]): string {
  return excerpts.join(EXCERPT_SEPARATOR);
}
