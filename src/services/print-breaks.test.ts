import { describe, expect, it } from "vitest";
import {
  blockAt,
  blockStart,
  breakMarks,
  MAX_BLOCK_POSITIONS,
  MAX_BLOCK_REPORT_CHARS,
  readBlockPositions,
  toggleBreak,
  type BlockPosition
} from "./print-breaks";

/**
 * Three blocks on page one, the third running over onto page two and a fourth
 * below it there, and a fifth opening page three at the top.
 */
const POSITIONS: BlockPosition[] = [
  { block: 0, page: 1, y: 50 },
  { block: 1, page: 1, y: 68 },
  { block: 2, page: 1, y: 400 },
  { block: 3, page: 2, y: 120 },
  { block: 4, page: 3, y: 50 }
];

describe("readBlockPositions", () => {
  it("reads the one report a document makes, in page order", () => {
    const report = JSON.stringify([
      [
        { block: 1, page: 2, y: 30.5 },
        { block: 0, page: 1, y: 49.9 }
      ]
    ]);
    expect(readBlockPositions(report)).toEqual([
      { block: 0, page: 1, y: 49.9 },
      { block: 1, page: 2, y: 30.5 }
    ]);
  });

  it("drops anything that is not a block, a page and a height", () => {
    const report = JSON.stringify([
      [
        { block: 0, page: 1, y: 10 },
        { block: -1, page: 1, y: 10 },
        { block: 1.5, page: 1, y: 10 },
        { block: 2, page: 0, y: 10 },
        { block: 3, page: 1, y: -4 },
        { block: 4, page: 1, y: "10" },
        null,
        "x"
      ],
      { block: 5, page: 1, y: 10 }
    ]);
    expect(readBlockPositions(report)).toEqual([{ block: 0, page: 1, y: 10 }]);
  });

  it("reads none from what is not a report", () => {
    expect(readBlockPositions(undefined)).toEqual([]);
    expect(readBlockPositions("not json")).toEqual([]);
    expect(readBlockPositions(JSON.stringify({ block: 0 }))).toEqual([]);
    expect(readBlockPositions("x".repeat(MAX_BLOCK_REPORT_CHARS + 1))).toEqual([]);
  });

  it("stops at the most a report may hold", () => {
    const many = Array.from({ length: MAX_BLOCK_POSITIONS + 5 }, (_, block) => ({
      block,
      page: 1,
      y: block
    }));
    expect(readBlockPositions(JSON.stringify([many]))).toHaveLength(MAX_BLOCK_POSITIONS);
  });
});

describe("blockAt", () => {
  it("finds the block a point lands in", () => {
    expect(blockAt(POSITIONS, 1, 60)).toBe(0);
    expect(blockAt(POSITIONS, 1, 68)).toBe(1);
    expect(blockAt(POSITIONS, 1, 700)).toBe(2);
    expect(blockAt(POSITIONS, 2, 500)).toBe(3);
  });

  it("reads a point above a page's first block as the block that ran over onto it", () => {
    expect(blockAt(POSITIONS, 2, 40)).toBe(2);
    expect(blockAt(POSITIONS, 2, 100)).toBe(2);
  });

  it("reads the top margin of a page that opens with a block as that block", () => {
    expect(blockAt(POSITIONS, 3, 20)).toBe(4);
    expect(blockAt(POSITIONS, 3, 300)).toBe(4);
  });

  it("finds none above a first block that something else stands over, or in an empty report", () => {
    const letter = [
      { block: 0, page: 1, y: 300 },
      { block: 1, page: 2, y: 50 }
    ];
    expect(blockAt(letter, 1, 100)).toBeNull();
    expect(blockAt([], 1, 300)).toBeNull();
  });
});

describe("toggleBreak", () => {
  it("adds a break before a block, in order, and takes it away again", () => {
    expect(toggleBreak([5], 2)).toEqual([2, 5]);
    expect(toggleBreak([2, 5], 2)).toEqual([5]);
  });

  it("does nothing for the first block, which starts a page already", () => {
    expect(toggleBreak([3], 0)).toEqual([3]);
  });
});

describe("where the preview draws breaks", () => {
  it("marks the top of each block a break moved", () => {
    expect(breakMarks(POSITIONS, [3, 9])).toEqual([{ block: 3, page: 2, y: 120 }]);
  });

  it("knows where a block starts, when the report has it", () => {
    expect(blockStart(POSITIONS, 2)).toEqual({ block: 2, page: 1, y: 400 });
    expect(blockStart(POSITIONS, 9)).toBeNull();
  });
});
