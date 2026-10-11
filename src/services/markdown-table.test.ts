import { describe, expect, it } from "vitest";
import {
  escapeCell,
  isTableDelimiter,
  rowCells,
  splitRow,
  TABLE_DELIMITER
} from "./markdown-table";

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

  it("reads a backtick with no partner of its length as text", () => {
    const cells = (line: string) => rowCells(line);
    expect(cells("| it`s | b | c |")).toEqual(["it`s", "b", "c"]);
    expect(cells("| a | `b | c |")).toEqual(["a", "`b", "c"]);
    expect(cells("| ``a` | b | c |")).toEqual(["``a`", "b", "c"]);
    expect(cells("| `a`` | b | c |")).toEqual(["`a``", "b", "c"]);
    expect(cells("| a` | b | c |")).toEqual(["a`", "b", "c"]);
  });

  it("closes a code span only with a run of the same length", () => {
    expect(rowCells("| ``a|b`` | c |")).toEqual(["``a|b``", "c"]);
    expect(rowCells("| `a|b`` | c |")).toEqual(["`a", "b``", "c"]);
    expect(rowCells("| ``a`|b`` | c |")).toEqual(["``a`|b``", "c"]);
    expect(rowCells("| `a``b|c` | d |")).toEqual(["`a``b|c`", "d"]);
  });

  it("lets a code span carry a pipe across cells when its partner is a later cell's", () => {
    expect(rowCells("| 5`a | 7`b |")).toEqual(["5`a | 7`b"]);
  });

  it("pairs each opening run with the first run of its length, not the last", () => {
    expect(rowCells("| `a | b` | c` |")).toEqual(["`a | b`", "c`"]);
  });

  it("does not count an escaped backtick as a run", () => {
    expect(rowCells("| 5\\`a | 7`b |")).toEqual(["5\\`a", "7`b"]);
    expect(rowCells("| `a\\`|b | c |")).toEqual(["`a\\`", "b", "c"]);
  });

  it("splits a row of many unpaired runs in one pass", () => {
    const row = `|${Array.from({ length: 4000 }, (_, i) => "`".repeat(i + 1)).join("|")}|`;
    const started = performance.now();
    expect(splitRow(row)).toHaveLength(4000);
    expect(performance.now() - started).toBeLessThan(500);
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

describe("escapeCell", () => {
  it.each(["a|b", "a\\|b", "a\\\\|b", "ends\\", "plain"])(
    "writes %s so that splitRow reads it back as one cell",
    (text) => {
      expect(rowCells(`| ${escapeCell(text)} | next |`)).toHaveLength(2);
    }
  );

  it.each([
    ["it`s", "b`c"],
    ["``a`", "`b``"],
    ["`a`b`", "c`d"],
    ["`code | pipe`", "x`"],
    ["a\\`b", "c`d"]
  ])("keeps %s and %s apart even though both hold backticks", (first, second) => {
    const row = `| ${escapeCell(first)} | ${escapeCell(second)} | ${escapeCell("`")} |`;
    expect(rowCells(row)).toHaveLength(3);
  });

  it("leaves a code span that closes inside the cell as it is", () => {
    expect(escapeCell("`a` and ``b`c``")).toBe("`a` and ``b`c``");
    expect(escapeCell("`a|b`")).toBe("`a\\|b`");
  });

  it("escapes every backtick of a run with no partner", () => {
    expect(escapeCell("it`s")).toBe("it\\`s");
    expect(escapeCell("``x`")).toBe("\\`\\`x\\`");
  });

  it("turns line breaks into <br>", () => {
    expect(escapeCell("a\r\nb\nc")).toBe("a<br>b<br>c");
  });
});
