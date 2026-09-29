import { describe, expect, it } from "vitest";
import { numberFormatFor } from "./amounts";
import type { FormulaContext } from "./formulas";
import {
  evaluateGrid,
  findTables,
  applyFreezes,
  formulaOutcomes,
  freezeFormulas,
  freezePlan,
  parseFormula,
  resolveFormulas
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

  it("reads a hand-typed space as the space the plugin writes", () => {
    // The bug: `320 €` typed with a plain space showed "now 320 €" beside itself.
    const [typed] = evaluateGrid([["A"], ["300 €"], ["20 €"], ["=sum(fixed: 320 €)"]], ctx);
    expect(typed?.now).toBeNull();
  });

  it("does not call a converted value changed when only the rates' day moved, or converting was switched", () => {
    const rates = { date: "2026-09-29", fetchedAt: 0, rates: { USD: 1.25 } };
    const grid = [["A"], ["300 €"], ["25 $"], ["=sum(fixed: ≈ 320,00 € · ECB 26.09.2026)"]];
    expect(evaluateGrid(grid, { ...ctx, defaultCurrency: "EUR", rates })[0]?.now).toBeNull();
    expect(evaluateGrid(grid, ctx)[0]?.now).toBeNull();
    const moved = [["A"], ["300 €"], ["50 $"], ["=sum(fixed: ≈ 320,00 € · ECB 26.09.2026)"]];
    expect(evaluateGrid(moved, { ...ctx, defaultCurrency: "EUR", rates })[0]?.now).toContain("340");
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

describe("freezePlan and applyFreezes", () => {
  const note = "| A | B |\n|---|---|\n| 5 € | x |\n| =sum(fixed) | =avg(fixed) |";

  it("plans each waiting fixed formula in order, with no number for one that has none", () => {
    expect(freezePlan(note, ctx).map((e) => ({ ...e, text: e.text && plain(e.text) }))).toEqual([
      { op: "sum", text: "5 €" },
      { op: "avg", text: null }
    ]);
  });

  it("plans nothing for a formula in prose or code, or one already frozen", () => {
    const prose = "Write =sum(fixed) in a cell.\n\n```\n| =sum(fixed) |\n```";
    expect(freezePlan(prose, ctx)).toEqual([]);
    expect(freezePlan("| A |\n|---|\n| =sum(fixed: 5) |", ctx)).toEqual([]);
  });

  it("writes the plan's values, not what the note says by then", () => {
    // The bug: freezing read the note again after the send, so an amount
    // changed while the PDF was made was frozen although it was never sent.
    const plan = freezePlan("| A |\n|---|\n| 5 € |\n| =sum(fixed) |", ctx);
    const edited = "| A |\n|---|\n| 7 € |\n| =sum(fixed) |";
    expect(plain(applyFreezes(edited, plan)?.text ?? "")).toContain("| =sum(fixed: 5 €) |");
  });

  it("refuses a note whose waiting formulas no longer match the plan", () => {
    const plan = freezePlan("| A |\n|---|\n| 5 |\n| =sum(fixed) |", ctx);
    expect(applyFreezes("| A |\n|---|\n| 5 |\n| =avg(fixed) |", plan)).toBeNull();
    expect(applyFreezes("| A |\n|---|\n| 5 |\n| =sum |", plan)).toBeNull();
  });

  it("freezes two in one row, each in its own cell", () => {
    const two = "| A | B |\n|---|---|\n| 1 | 2 |\n| =sum(fixed) | =max(fixed) |";
    expect(applyFreezes(two, freezePlan(two, ctx))?.text).toContain(
      "| =sum(fixed: 1) | =max(fixed: 2) |"
    );
  });
});

describe("formulaOutcomes", () => {
  it("lists what every formula in every table comes to", () => {
    const note = `${NOTE}\n\n| B |\n|---|\n| 1 € |\n| 2 $ |\n| =avg |`;
    expect(formulaOutcomes(note, ctx).map((outcome) => outcome.kind)).toEqual(["value", "mixed"]);
  });
});
