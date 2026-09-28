import { describe, expect, it } from "vitest";
import { numberFormatFor } from "./amounts";
import type { FormulaContext } from "./formulas";
import {
  evaluateGrid,
  findTables,
  formulaOutcomes,
  freezeFormulas,
  hasUnfrozenFormulas,
  parseFormula,
  resolveFormulas,
  splitRow
} from "./table-formulas";

const ctx: FormulaContext = {
  format: numberFormatFor("comma", "en"),
  defaultCurrency: "",
  rates: null
};

/** Intl puts a space that cannot break before the euro sign; tests read plain ones. */
const plain = (text: string) => text.replace(/\u00a0|\u202f/g, " ");
const unavailable = () => "–";

const NOTE = `# Budget

| Item      | Amount |
|-----------|--------|
| Groceries | 300 €  |
| Car       | 20 €   |
| **Total** | =sum   |

After the table.`;

describe("parseFormula", () => {
  it("reads every operation, in any case, with or without emphasis", () => {
    expect(parseFormula(" =sum ")).toEqual({ op: "sum", fixed: false, frozen: null, wrap: "" });
    expect(parseFormula("=MEDIAN")?.op).toBe("median");
    expect(parseFormula("**=avg**")).toMatchObject({ op: "avg", wrap: "**" });
  });

  it("reads a fixed formula, frozen or not", () => {
    expect(parseFormula("=sum(fixed)")).toMatchObject({ fixed: true, frozen: null });
    expect(parseFormula("=sum( fixed : 342,17 € )")).toMatchObject({
      fixed: true,
      frozen: "342,17 €"
    });
  });

  it("reads nothing else as a formula", () => {
    expect(parseFormula("=total")).toBeNull();
    expect(parseFormula("x =sum")).toBeNull();
    expect(parseFormula("**=sum*")).toBeNull();
    expect(parseFormula("=sum(later)")).toBeNull();
  });
});

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
});

describe("findTables", () => {
  it("finds a table with its header and body rows", () => {
    const [table] = findTables(NOTE);
    expect(table?.rows.map((row) => row.line)).toEqual([2, 4, 5, 6]);
  });

  it("does not find one in a code block, under a rule, or with a mismatched delimiter", () => {
    expect(findTables("```\n| a |\n|---|\n```")).toEqual([]);
    expect(findTables("Title\n---")).toEqual([]);
    expect(findTables("| a | b |\n|---|")).toEqual([]);
  });

  it("ends a table at a blank line", () => {
    const [table] = findTables("| a |\n|---|\n| 1 |\n\n| 2 |");
    expect(table?.rows).toHaveLength(2);
  });
});

describe("evaluateGrid", () => {
  const grid = [
    ["Item", "Amount"],
    ["Groceries", "300 €"],
    ["Car", "20 €"],
    ["Typo", "zwanzig"],
    ["Quoted", '"5 €"'],
    ["Subtotal", "=sum"],
    ["Bike", "10 €"],
    ["Total", "=sum"]
  ];

  it("works on the cells above, back to the header, without other formulas", () => {
    const results = evaluateGrid(grid, ctx);
    expect(results.map((r) => plain(r.text ?? ""))).toEqual(["320 €", "330 €"]);
  });

  it("counts the unreadable cells it left out, and not the quoted ones", () => {
    expect(evaluateGrid(grid, ctx)[0]?.skipped).toBe(1);
  });

  it("does not count the header", () => {
    expect(evaluateGrid([["100"], ["=sum"]], ctx)[0]?.text).toBe("0");
  });

  it("shows a frozen formula's own text, and what it would be now when that differs", () => {
    const [same] = evaluateGrid([["A"], ["5"], ["=sum(fixed: 5)"]], ctx);
    expect(same).toMatchObject({ text: "5", now: null, freezeAt: null });
    const [changed] = evaluateGrid([["A"], ["7"], ["=sum(fixed: 5)"]], ctx);
    expect(changed).toMatchObject({ text: "5", now: "7" });
  });

  it("offers a fixed formula not frozen yet its value to freeze at", () => {
    const [result] = evaluateGrid([["A"], ["5"], ["=sum(fixed)"]], ctx);
    expect(result).toMatchObject({ text: "5", freezeAt: "5" });
  });

  it("has no text for a result without a number", () => {
    const [result] = evaluateGrid([["A"], ["=avg"]], ctx);
    expect(result).toMatchObject({ text: null, outcome: { kind: "none" } });
  });
});

describe("resolveFormulas", () => {
  it("writes each result into its cell and leaves the rest of the note alone", () => {
    const resolved = plain(resolveFormulas(NOTE, ctx, unavailable));
    expect(resolved).toContain("| **Total** | 320 €   |");
    expect(resolved.replace("320 €", "=sum")).toBe(NOTE);
  });

  it("keeps emphasis around the result, and escapes a pipe in it", () => {
    const note = "| A |\n|---|\n| 5 |\n| **=sum** |";
    expect(resolveFormulas(note, ctx, unavailable)).toContain("| **5** |");
    expect(resolveFormulas("| A |\n|---|\n| =avg |", ctx, () => "a|b")).toContain("a\\|b");
  });

  it("puts a result without a number into words", () => {
    expect(resolveFormulas("| A |\n|---|\n| =avg |", ctx, unavailable)).toContain("| – |");
  });

  it("resolves two formulas in one row", () => {
    const note = "| A | B |\n|---|---|\n| 1 | 2 |\n| =sum | =count |";
    expect(resolveFormulas(note, ctx, unavailable)).toContain("| 1 | 1 |");
  });
});

describe("freezeFormulas", () => {
  it("freezes a fixed formula at its result, once", () => {
    const note = "| A |\n|---|\n| 5 € |\n| 7 € |\n| **=sum(fixed)** |";
    const first = freezeFormulas(note, ctx);
    expect(first.frozen).toBe(1);
    expect(plain(first.text)).toContain("| **=sum(fixed: 12 €)** |");
    expect(freezeFormulas(first.text, ctx)).toEqual({ text: first.text, frozen: 0 });
  });

  it("leaves live formulas and ones without a number alone", () => {
    const note = "| A | B |\n|---|---|\n| 5 | x |\n| =sum | =avg(fixed) |";
    expect(freezeFormulas(note, ctx)).toEqual({ text: note, frozen: 0 });
  });

  it("keeps parentheses out of the frozen text, where they would end it", () => {
    const rates = { date: "2026-09-26", fetchedAt: 0, rates: { USD: 1.25 } };
    const note = "| A |\n|---|\n| 5 € |\n| 5 $ |\n| =sum(fixed) |";
    const frozen = freezeFormulas(note, { ...ctx, defaultCurrency: "EUR", rates }).text;
    expect(plain(frozen)).toContain("=sum(fixed: ≈ 9,00 € · ECB 26.09.2026)");
    expect(parseFormula(frozen.split("\n")[4]!.slice(1, -1))?.frozen).toContain("9,00");
  });
});

describe("hasUnfrozenFormulas", () => {
  it("finds a fixed formula waiting to be frozen, and nothing else", () => {
    expect(hasUnfrozenFormulas("| =sum(fixed) |")).toBe(true);
    expect(hasUnfrozenFormulas("| =sum(fixed: 5) |")).toBe(false);
    expect(hasUnfrozenFormulas("| =sum |")).toBe(false);
  });
});

describe("formulaOutcomes", () => {
  it("lists what every formula in every table comes to", () => {
    const note = `${NOTE}\n\n| B |\n|---|\n| 1 € |\n| 2 $ |\n| =avg |`;
    expect(formulaOutcomes(note, ctx).map((outcome) => outcome.kind)).toEqual(["value", "mixed"]);
  });
});
