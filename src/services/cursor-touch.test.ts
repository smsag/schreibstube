import { describe, expect, it } from "vitest";
import { touchesRange } from "./cursor-touch";

const at = (...heads: number[]) => heads.map((head) => ({ from: head, to: head }));

describe("a cursor", () => {
  it("is on the text when it is inside it", () => {
    expect(touchesRange(at(7), 5, 10)).toBe(true);
  });

  it("is on the text at either edge, where it arrives from", () => {
    expect(touchesRange(at(5), 5, 10)).toBe(true);
    expect(touchesRange(at(10), 5, 10)).toBe(true);
  });

  it("is not on the text one character away", () => {
    expect(touchesRange(at(4), 5, 10)).toBe(false);
    expect(touchesRange(at(11), 5, 10)).toBe(false);
  });
});

describe("a selection", () => {
  it("touches the text when it overlaps any part of it", () => {
    expect(touchesRange([{ from: 0, to: 6 }], 5, 10)).toBe(true);
    expect(touchesRange([{ from: 9, to: 20 }], 5, 10)).toBe(true);
  });

  it("touches the text when it covers all of it", () => {
    expect(touchesRange([{ from: 0, to: 99 }], 5, 10)).toBe(true);
  });

  it("does not touch text it ends before or starts after", () => {
    expect(touchesRange([{ from: 0, to: 4 }], 5, 10)).toBe(false);
    expect(touchesRange([{ from: 11, to: 20 }], 5, 10)).toBe(false);
  });
});

describe("several cursors", () => {
  it("count when any one of them is on the text", () => {
    expect(touchesRange(at(0, 7, 30), 5, 10)).toBe(true);
    expect(touchesRange(at(0, 30), 5, 10)).toBe(false);
  });
});
