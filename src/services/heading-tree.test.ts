import { describe, expect, it } from "vitest";
import {
  collapsedCrumbs,
  nextSection,
  parentOf,
  previousSection,
  sameHeadings,
  sectionCommandTarget,
  sectionPosition,
  siblingsOf,
  type SectionMove
} from "./heading-tree";
import type { HeadingEntry, HeadingIndex } from "../types";

const index: HeadingIndex = [
  { level: 1, text: "Nimbus", lineNumber: 0 },
  { level: 2, text: "Installation", lineNumber: 4 },
  { level: 3, text: "macOS", lineNumber: 8 },
  { level: 3, text: "iOS", lineNumber: 13 },
  { level: 2, text: "Usage", lineNumber: 18 },
  { level: 2, text: "FAQ", lineNumber: 30 },
  { level: 1, text: "Licence", lineNumber: 40 }
];
const at = (line: number): HeadingEntry => {
  const heading = index.find((entry) => entry.lineNumber === line);
  if (!heading) throw new Error(`no heading on line ${line}`);
  return heading;
};
const lines = (entries: HeadingEntry[]) => entries.map((entry) => entry.lineNumber);

describe("the heading tree", () => {
  it("finds the heading a section sits under, and none above the top", () => {
    expect(parentOf(index, at(13))).toEqual(at(4));
    expect(parentOf(index, at(0))).toBeNull();
  });

  it("nests a skipped level the way the note reads", () => {
    const skipping: HeadingIndex = [
      { level: 1, text: "A", lineNumber: 0 },
      { level: 3, text: "deep", lineNumber: 2 },
      { level: 2, text: "B", lineNumber: 5 }
    ];
    expect(lines(siblingsOf(skipping, { level: 3, text: "deep", lineNumber: 2 }))).toEqual([2, 5]);
  });

  it("lists the sections beside one, itself among them", () => {
    expect(lines(siblingsOf(index, at(18)))).toEqual([4, 18, 30]);
    expect(lines(siblingsOf(index, at(40)))).toEqual([0, 40]);
  });

  it("says where a section stands among its siblings", () => {
    expect(sectionPosition(index, at(18))).toEqual({ position: 2, count: 3 });
    expect(sectionPosition(index, { level: 2, text: "gone", lineNumber: 99 })).toBeNull();
  });
});

describe("moving by section", () => {
  it("goes past everything under the section to the next one", () => {
    expect(nextSection(index, at(4))).toEqual(at(18));
    expect(nextSection(index, at(13))).toEqual(at(18));
    expect(nextSection(index, at(30))).toEqual(at(40));
    expect(nextSection(index, at(40))).toBeNull();
  });

  it("goes to the first heading from above it", () => {
    expect(nextSection(index, null)).toEqual(at(0));
    expect(nextSection([], null)).toBeNull();
  });

  it("goes back a sibling, or up to the section a first sibling is in", () => {
    expect(previousSection(index, at(18))).toEqual(at(4));
    expect(previousSection(index, at(8))).toEqual(at(4));
    expect(previousSection(index, at(0))).toBeNull();
    expect(previousSection(index, null)).toBeNull();
  });
});

describe("collapsedCrumbs", () => {
  it("shows the whole path when nothing needs to give way", () => {
    expect(collapsedCrumbs(4, 0)).toEqual({ shown: [0, 1, 2, 3], hidden: [] });
  });

  it("folds from the outermost crumb inwards, keeping those nearest the section", () => {
    expect(collapsedCrumbs(5, 2)).toEqual({ shown: [2, 3, 4], hidden: [0, 1] });
  });

  it("never folds the section being read", () => {
    expect(collapsedCrumbs(4, 9)).toEqual({ shown: [3], hidden: [0, 1, 2] });
    expect(collapsedCrumbs(1, 1)).toEqual({ shown: [0], hidden: [] });
  });
});

describe("sameHeadings", () => {
  it("holds for the same headings, though built anew", () => {
    expect(
      sameHeadings(
        index,
        index.map((heading) => ({ ...heading }))
      )
    ).toBe(true);
  });

  it("tells a heading moved, renamed, re-levelled, added or removed", () => {
    const changed = (patch: Partial<HeadingEntry>) =>
      index.map((heading, i) => (i === 2 ? { ...heading, ...patch } : heading));
    expect(sameHeadings(index, changed({ lineNumber: 9 }))).toBe(false);
    expect(sameHeadings(index, changed({ text: "Linux" }))).toBe(false);
    expect(sameHeadings(index, changed({ level: 2 }))).toBe(false);
    expect(sameHeadings(index, index.slice(1))).toBe(false);
  });
});

describe("sectionCommandTarget", () => {
  const target = (move: SectionMove, stack: HeadingEntry[], active = true) =>
    sectionCommandTarget({ active, headingIndex: index, ancestorStack: stack, move });

  it("is not offered where the stack is not at work", () => {
    expect(target("next", [at(0), at(4)], false)).toBeNull();
  });

  it("moves from the section the stack shows", () => {
    const stack = [at(0), at(4), at(13)];
    expect(target("next", stack)).toBe(18);
    expect(target("previous", stack)).toBe(8);
    expect(target("parent", stack)).toBe(4);
  });

  it("is not offered where there is nowhere to go", () => {
    expect(target("parent", [at(0)])).toBeNull();
    expect(target("previous", [])).toBeNull();
    expect(target("next", [at(40)])).toBeNull();
  });

  it("goes to the first heading from above it", () => {
    expect(target("next", [])).toBe(0);
  });
});
