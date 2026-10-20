import { describe, expect, it } from "vitest";
import {
  collectExcerpts,
  isYellow,
  markedCharacters,
  markLayers,
  marksBothWays,
  marksWithoutText,
  MAX_BOXES_PER_MARK,
  MAX_MARKS_PER_PAGE,
  quadBoxes,
  runningText,
  toMark,
  toPlacedRun,
  type PdfBox,
  type PdfMark,
  type PdfMarkedPage,
  type PdfPlacedRun
} from "./pdf-highlights";

/** Every character one point wide, so a box's x is a character index. */
function line(
  text: string,
  y: number,
  options: { x?: number; endsLine?: boolean } = {}
): PdfPlacedRun {
  return {
    text,
    endsLine: options.endsLine ?? true,
    x: options.x ?? 0,
    y,
    width: Array.from(text).length,
    height: 10
  };
}

/** A box over characters `from` to `to` (exclusive) of the line at `y`, the line's full height. */
function over(from: number, to: number, y: number): PdfBox {
  return { x0: from, x1: to, y0: y - 2, y1: y + 9 };
}

const PREVIEW_YELLOW: [number, number, number] = [250, 205, 90];
const PREVIEW_RED: [number, number, number] = [236, 40, 20];

function highlight(...boxes: PdfBox[]): PdfMark {
  return { kind: "highlight", color: PREVIEW_YELLOW, boxes };
}

function underline(...boxes: PdfBox[]): PdfMark {
  return { kind: "underline", color: PREVIEW_RED, boxes };
}

/** The same boxes highlighted in yellow and underlined: the text that counts. */
function both(...boxes: PdfBox[]): PdfMark[] {
  return [highlight(...boxes), underline(...boxes)];
}

function page(runs: PdfPlacedRun[], marks: PdfMark[], number = 1): PdfMarkedPage {
  return { page: number, runs, marks };
}

describe("which colours are yellow", () => {
  it("takes the yellows the reading apps write", () => {
    expect(isYellow(PREVIEW_YELLOW)).toBe(true);
    expect(isYellow([255, 255, 0])).toBe(true);
    expect(isYellow([255, 226, 0])).toBe(true);
    expect(isYellow([252, 244, 120])).toBe(true);
  });

  it("leaves out the other highlight colours", () => {
    expect(isYellow([120, 220, 90])).toBe(false); // green
    expect(isYellow([90, 170, 250])).toBe(false); // blue
    expect(isYellow([250, 120, 180])).toBe(false); // pink
    expect(isYellow([190, 120, 240])).toBe(false); // purple
    expect(isYellow([255, 140, 0])).toBe(false); // orange
    expect(isYellow(PREVIEW_RED)).toBe(false);
  });

  it("leaves out what is too dull or too dark to be a marker", () => {
    expect(isYellow([240, 235, 215])).toBe(false); // beige
    expect(isYellow([120, 110, 20])).toBe(false); // olive
    expect(isYellow([255, 255, 255])).toBe(false);
    expect(isYellow(null)).toBe(false);
  });

  it("puts yellow highlights in one layer and underlines of any colour in the other", () => {
    const box = over(0, 1, 100);
    const [highlights, underlines] = markLayers([
      highlight(box),
      { kind: "highlight", color: [90, 170, 250], boxes: [over(5, 6, 100)] },
      underline(box),
      { kind: "underline", color: null, boxes: [over(8, 9, 100)] }
    ]);
    expect(highlights).toEqual([box]);
    expect(underlines).toEqual([box, over(8, 9, 100)]);
  });
});

describe("reading what pdf.js hands over", () => {
  it("turns each eight numbers of a quad list into a box", () => {
    const quads = new Float32Array([
      84, 561, 454, 561, 84, 548, 454, 548, 84, 547, 300, 547, 84, 534, 300, 534
    ]);
    expect(quadBoxes(quads)).toEqual([
      { x0: 84, x1: 454, y0: 548, y1: 561 },
      { x0: 84, x1: 300, y0: 534, y1: 547 }
    ]);
  });

  it("refuses a quad list that is not numbers, and drops a half quad at the end", () => {
    expect(quadBoxes("84,561")).toEqual([]);
    expect(quadBoxes([1, 2, 3, Number.NaN, 5, 6, 7, 8])).toEqual([]);
    expect(quadBoxes([0, 1, 1, 1, 0, 0, 1, 0, 9, 9])).toHaveLength(1);
  });

  it("stops at the bound on boxes per mark", () => {
    const quads = Array.from({ length: (MAX_BOXES_PER_MARK + 5) * 8 }, (_, i) => i % 8);
    expect(quadBoxes(quads)).toHaveLength(MAX_BOXES_PER_MARK);
  });

  it("reads a highlight and an underline, and nothing else", () => {
    const quadPoints = [0, 10, 5, 10, 0, 0, 5, 0];
    expect(
      toMark({ subtype: "Highlight", color: new Uint8ClampedArray(PREVIEW_YELLOW), quadPoints })
    ).toEqual({
      kind: "highlight",
      color: PREVIEW_YELLOW,
      boxes: [{ x0: 0, x1: 5, y0: 0, y1: 10 }]
    });
    expect(toMark({ subtype: "Underline", quadPoints })?.kind).toBe("underline");
    expect(toMark({ subtype: "Underline", quadPoints })?.color).toBeNull();
    expect(toMark({ subtype: "Link", quadPoints })).toBeNull();
    expect(toMark({ subtype: "StrikeOut", quadPoints })).toBeNull();
    expect(toMark({ subtype: "Highlight" })).toBeNull();
    expect(toMark(null)).toBeNull();
    expect(toMark("Highlight")).toBeNull();
  });

  it("keeps a colour inside the range a colour can have", () => {
    const mark = toMark({
      subtype: "Highlight",
      color: [300, -4, 90, 1],
      quadPoints: [0, 1, 1, 1, 0, 0, 1, 0]
    });
    expect(mark?.color).toEqual([255, 0, 90]);
  });

  it("reads a text item with its place, and refuses one without", () => {
    expect(
      toPlacedRun({
        str: "Ecosystems",
        hasEOL: true,
        transform: [10, 0, 0, 10, 84, 548],
        width: 52,
        height: 10
      })
    ).toEqual({ text: "Ecosystems", endsLine: true, x: 84, y: 548, width: 52, height: 10 });
    expect(toPlacedRun({ str: "x", transform: [1, 0, 0, 1, 0, 0] })?.width).toBe(0);
    expect(
      toPlacedRun({ str: "x", transform: [1, 0, 0, 11, 0, 0], width: 1, height: 0 })?.height
    ).toBe(11);
    expect(toPlacedRun({ str: "x" })).toBeNull();
    expect(toPlacedRun({ str: 4, transform: [1, 0, 0, 1, 0, 0] })).toBeNull();
    expect(toPlacedRun(undefined)).toBeNull();
  });
});

describe("which characters a mark covers", () => {
  const shown = (run: PdfPlacedRun, marked: boolean[]): string =>
    marked.map((on, i) => (on ? run.text[i] : "")).join("");

  it("takes the characters whose middle is inside a box of every layer", () => {
    const run = line("one two three", 100);
    expect(shown(run, markedCharacters(run, [[over(4, 7, 100)]]))).toBe("two");
    expect(shown(run, markedCharacters(run, [[over(0, 7, 100)], [over(4, 13, 100)]]))).toBe("two");
  });

  it("marks nothing when a layer is empty", () => {
    const run = line("one two", 100);
    expect(markedCharacters(run, [[over(0, 7, 100)], []]).some(Boolean)).toBe(false);
    expect(markedCharacters(run, []).some(Boolean)).toBe(false);
  });

  it("completes a word more than half marked, and drops one half marked or less", () => {
    const run = line("But then In", 100);
    // "ut then I": two of three letters of "But", one of two of "In".
    expect(shown(run, markedCharacters(run, [[over(1, 10, 100)]]))).toBe("But then ");
  });

  it("settles a word on the letters under both marks, not under either", () => {
    const run = line("overlapping", 100);
    // Highlighted 0–6, underlined 4–11: both cover only 4 of 11 letters.
    expect(markedCharacters(run, [[over(0, 6, 100)], [over(4, 11, 100)]]).some(Boolean)).toBe(
      false
    );
  });

  it("does not reach the line below or above", () => {
    const upper = line("upper line", 112);
    const lower = line("lower line", 100);
    const box = over(0, 10, 100);
    expect(markedCharacters(upper, [[box]]).some(Boolean)).toBe(false);
    expect(markedCharacters(lower, [[box]]).every(Boolean)).toBe(true);
  });

  it("takes an underline drawn as a thin strip under the baseline", () => {
    const run = line("under", 100);
    const strip: PdfBox = { x0: 0, x1: 5, y0: 98.5, y1: 99.5 };
    expect(markedCharacters(run, [[over(0, 5, 100)], [strip]]).every(Boolean)).toBe(true);
  });

  it("marks nothing in an empty run", () => {
    expect(markedCharacters(line("", 100), [[over(0, 5, 100)]])).toEqual([]);
  });
});

describe("the excerpts of a document", () => {
  it("takes only the text that is both highlighted in yellow and underlined", () => {
    const runs = [line("only yellow, both marks here, only underlined", 100)];
    const marks = [highlight(over(0, 28, 100)), underline(over(13, 45, 100))];
    expect(collectExcerpts([page(runs, marks)])).toEqual(["both marks here"]);
  });

  it("leaves out text with one mark only", () => {
    const runs = [line("highlighted", 100), line("underlined", 88)];
    const marks = [highlight(over(0, 11, 100)), underline(over(0, 10, 88))];
    expect(collectExcerpts([page(runs, marks)])).toEqual([]);
  });

  it("does not count a highlight of another colour as the highlight", () => {
    const runs = [line("blue and underlined", 100)];
    const marks: PdfMark[] = [
      { kind: "highlight", color: [90, 170, 250], boxes: [over(0, 19, 100)] },
      underline(over(0, 19, 100))
    ];
    expect(collectExcerpts([page(runs, marks)])).toEqual([]);
  });

  it("joins marked lines into prose and closes up a word split across them", () => {
    const runs = [line("The organi-", 100), line("zation of firms", 88), line("is next.", 76)];
    const marks = both(over(0, 11, 100), over(0, 15, 88));
    expect(collectExcerpts([page(runs, marks)])).toEqual(["The organization of firms"]);
  });

  it("separates two marked passages with unmarked words between them", () => {
    const runs = [line("First part, skipped words, second part.", 100)];
    const marks = both(over(0, 10, 100), over(27, 39, 100));
    const excerpts = collectExcerpts([page(runs, marks)]);
    expect(excerpts).toEqual(["First part", "second part."]);
    expect(runningText(excerpts)).toBe("First part […] second part.");
  });

  it("makes one excerpt where the overlaps of separate marks meet", () => {
    const runs = [line("alpha beta gamma", 100)];
    const marks = [
      highlight(over(0, 6, 100)),
      highlight(over(6, 16, 100)),
      underline(over(0, 16, 100))
    ];
    expect(collectExcerpts([page(runs, marks)])).toEqual(["alpha beta gamma"]);
  });

  it("keeps an unmarked comma between marked words, and drops one before the first", () => {
    const runs = [line("so, I believe, the key", 100)];
    // Marked: ", I believe" and "the key", with the second comma left out.
    const marks = both(over(2, 13, 100), over(15, 22, 100));
    expect(collectExcerpts([page(runs, marks)])).toEqual(["I believe, the key"]);
  });

  it("goes through the pages in order, the page furniture between them ending an excerpt", () => {
    const first = page([line("End of page one", 100), line("12", 20)], both(over(0, 15, 100)), 1);
    const second = page([line("Top of page two", 700)], both(over(0, 15, 700)), 2);
    expect(collectExcerpts([first, second])).toEqual(["End of page one", "Top of page two"]);
  });

  it("ends an excerpt at a page break, even with nothing unmarked between", () => {
    // The last run of a page seldom ends a line in pdf.js's reading.
    const first = page([line("Ende", 100, { endsLine: false })], both(over(0, 4, 100)), 3);
    const second = page([line("Anfang", 700)], both(over(0, 6, 700)), 4);
    expect(runningText(collectExcerpts([first, second]))).toBe("Ende […] Anfang");
  });

  it("reads runs that share a line without inventing a space", () => {
    const runs = [line("Inter", 100, { endsLine: false }), line("estingly so", 100, { x: 5 })];
    expect(collectExcerpts([page(runs, both(over(0, 16, 100)))])).toEqual(["Interestingly so"]);
  });

  it("ignores marks past the bound on a page", () => {
    const runs = [line("word", 100)];
    const blue: PdfMark = { kind: "highlight", color: [90, 170, 250], boxes: [] };
    const marks = [
      ...Array.from({ length: MAX_MARKS_PER_PAGE }, () => blue),
      ...both(over(0, 4, 100))
    ];
    expect(collectExcerpts([page(runs, marks)])).toEqual([]);
  });

  it("finds nothing where nothing is marked", () => {
    expect(collectExcerpts([page([line("plain", 100)], [])])).toEqual([]);
    expect(collectExcerpts([])).toEqual([]);
    expect(runningText([])).toBe("");
  });
});

describe("why nothing was found", () => {
  it("is a missing text layer when both marks lie over a page without text", () => {
    expect(marksWithoutText([page([], both(over(0, 5, 100)))])).toBe(true);
    expect(marksWithoutText([page([line("  ", 100)], both(over(0, 5, 100)))])).toBe(true);
  });

  it("is not, when the page has text or lacks one of the marks", () => {
    expect(marksWithoutText([page([line("text", 100)], both(over(0, 5, 100)))])).toBe(false);
    expect(marksWithoutText([page([], [highlight(over(0, 5, 100))])])).toBe(false);
    expect(marksWithoutText([page([], [underline(over(0, 5, 100))])])).toBe(false);
  });
});

describe("which pages are worth reading", () => {
  it("are the pages with both a yellow highlight and an underline", () => {
    expect(marksBothWays(both(over(0, 1, 100)))).toBe(true);
    expect(marksBothWays([highlight(over(0, 1, 100))])).toBe(false);
    expect(marksBothWays([underline(over(0, 1, 100))])).toBe(false);
    expect(
      marksBothWays([
        { kind: "highlight", color: [90, 170, 250], boxes: [over(0, 1, 100)] },
        underline(over(0, 1, 100))
      ])
    ).toBe(false);
  });
});
