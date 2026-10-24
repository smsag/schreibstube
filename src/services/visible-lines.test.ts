import { describe, expect, it } from "vitest";
import { visibleLineRuns } from "./visible-lines";

/** Lines of ten characters each, the newline included: position 25 is on line 3. */
const lineAt = (position: number): number => Math.floor(position / 10) + 1;

describe("the lines on screen", () => {
  it("are one run for one range", () => {
    expect(visibleLineRuns([{ from: 0, to: 39 }], lineAt)).toEqual([{ first: 1, last: 4 }]);
  });

  it("name a line split by a stretch drawn as something else only once", () => {
    // A widget from position 12 to 18, inside line 2.
    const ranges = [
      { from: 0, to: 12 },
      { from: 18, to: 39 }
    ];
    expect(visibleLineRuns(ranges, lineAt)).toEqual([{ first: 1, last: 4 }]);
  });

  it("join runs that meet at a line boundary", () => {
    const ranges = [
      { from: 0, to: 19 },
      { from: 20, to: 39 }
    ];
    expect(visibleLineRuns(ranges, lineAt)).toEqual([{ first: 1, last: 4 }]);
  });

  it("keep the lines a fold hides out", () => {
    const ranges = [
      { from: 0, to: 19 },
      { from: 59, to: 79 }
    ];
    expect(visibleLineRuns(ranges, lineAt)).toEqual([
      { first: 1, last: 2 },
      { first: 6, last: 8 }
    ]);
  });

  it("are none for an editor that draws nothing", () => {
    expect(visibleLineRuns([], lineAt)).toEqual([]);
  });
});
