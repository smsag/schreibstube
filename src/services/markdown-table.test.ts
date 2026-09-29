import { describe, expect, it } from "vitest";
import { isTableDelimiter, rowCells, splitRow, TABLE_DELIMITER } from "./markdown-table";

describe("splitRow", () => {
  it("splits at pipes, not at escaped ones or ones in code", () => {
    expect(splitRow("| a | b \\| c | `d|e` |").map((cell) => cell.text.trim())).toEqual([
      "a",
      "b \\| c",
      "`d|e`"
    ]);
  });

  it("reads a row without its outer pipes", () => {
    expect(splitRow("a | b").map((cell) => cell.text.trim())).toEqual(["a", "b"]);
  });

  it("keeps where each cell sits in the line", () => {
    const [first, second] = splitRow("| ab | c |");
    expect(first).toEqual({ from: 1, to: 5, text: " ab " });
    expect(second).toEqual({ from: 6, to: 9, text: " c " });
  });

  it("hands out the trimmed text alone", () => {
    expect(rowCells("| a | `b|c` |  ")).toEqual(["a", "`b|c`"]);
  });
});

describe("isTableDelimiter", () => {
  it("accepts the shapes a delimiter row is written in", () => {
    for (const line of ["|---|", "| :-: | --: |", "---|---", "  |-|  ", ":--", "|---|---|"]) {
      expect(isTableDelimiter(line), line).toBe(true);
    }
  });

  it("refuses rows without a dash in every cell", () => {
    for (const line of ["| a |", "| |", "|---| x |", "", "|", "--- text"]) {
      expect(isTableDelimiter(line), line).toBe(false);
    }
  });

  it("refuses a line of thirty thousand spaces at once", () => {
    const spaces = " ".repeat(30_000);
    for (const line of [spaces, `|${spaces}`, `-${spaces}-`, `|-${spaces}x`, `${spaces}|`]) {
      const started = performance.now();
      const result = TABLE_DELIMITER.test(line.trim());
      expect(performance.now() - started).toBeLessThan(20);
      expect(result).toBe(false);
    }
  });
});
