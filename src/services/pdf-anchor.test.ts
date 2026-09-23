import { describe, expect, it } from "vitest";
import { isUsableSelection, parsePdfSubpath, pdfSubpath } from "./pdf-anchor";
import type { PdfSelection } from "./pdf-anchor";

const selection: PdfSelection = { beginIndex: 4, beginOffset: 0, endIndex: 6, endOffset: 31 };

describe("pdfSubpath", () => {
  it("writes the page alone when nothing finer was measured", () => {
    expect(pdfSubpath({ page: 12 })).toBe("page=12");
  });

  it("writes the four selection numbers in the order the viewer reads them", () => {
    expect(pdfSubpath({ page: 12, selection })).toBe("page=12&selection=4,0,6,31");
  });

  it("drops a selection it cannot trust rather than pointing at the wrong words", () => {
    const backwards = { beginIndex: 6, beginOffset: 0, endIndex: 4, endOffset: 3 };
    expect(pdfSubpath({ page: 12, selection: backwards })).toBe("page=12");
  });

  it("refuses a page that is not a page", () => {
    expect(() => pdfSubpath({ page: 0 })).toThrow(/whole number from 1/);
    expect(() => pdfSubpath({ page: 1.5 })).toThrow(/whole number from 1/);
  });
});

describe("isUsableSelection", () => {
  it("accepts a range that ends after it starts", () => {
    expect(isUsableSelection(selection)).toBe(true);
    expect(isUsableSelection({ beginIndex: 2, beginOffset: 1, endIndex: 2, endOffset: 9 })).toBe(
      true
    );
  });

  it("rejects an empty range inside one item", () => {
    expect(isUsableSelection({ beginIndex: 2, beginOffset: 5, endIndex: 2, endOffset: 5 })).toBe(
      false
    );
  });

  it("rejects fractions and negatives, which no reading produces", () => {
    expect(isUsableSelection({ ...selection, beginIndex: -1 })).toBe(false);
    expect(isUsableSelection({ ...selection, endOffset: 2.5 })).toBe(false);
  });

  it("rejects nothing at all", () => {
    expect(isUsableSelection(undefined)).toBe(false);
  });
});

describe("parsePdfSubpath", () => {
  it("reads back what it writes", () => {
    const anchor = { page: 12, selection };
    expect(parsePdfSubpath(pdfSubpath(anchor))).toEqual(anchor);
  });

  it("tolerates the leading hash a link carries", () => {
    expect(parsePdfSubpath("#page=3")).toEqual({ page: 3 });
  });

  it("keeps the page when the selection is malformed", () => {
    expect(parsePdfSubpath("page=3&selection=4,0")).toEqual({ page: 3 });
    expect(parsePdfSubpath("page=3&selection=9,0,4,1")).toEqual({ page: 3 });
  });

  it("answers nothing for a subpath that addresses no page", () => {
    expect(parsePdfSubpath("height=400")).toBeNull();
    expect(parsePdfSubpath("page=0")).toBeNull();
    expect(parsePdfSubpath("")).toBeNull();
  });

  it("ignores parameters it does not know, rather than failing on them", () => {
    expect(parsePdfSubpath("page=7&height=400")).toEqual({ page: 7 });
  });
});
