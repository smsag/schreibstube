import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURRENCY_CODES } from "./amounts";
import {
  CALCULATION_SIGNS,
  CALCULATION_UNITS,
  acceptedLine,
  calculateLine,
  calculationLines,
  type CalculationContext,
  type CalculationFormat
} from "./line-calculator";

/**
 * Calculation lines are read here and again by a quick-note app writing into the
 * same vault. The examples are shared, so a line that shows one result in the
 * note and another in the quick note fails on whichever side moved.
 */
interface Cases {
  formats: Record<CalculationFormat, { group: string; decimal: string }>;
  signs: Record<string, string>;
  currencies: string[];
  units: Record<string, { kind: string; factor: number; offset: number }>;
  lines: { name?: string; format: CalculationFormat; line: string; result: string | null }[];
  documents: {
    name: string;
    format: CalculationFormat;
    text: string;
    results: [number, string][];
  }[];
  accept: { format: CalculationFormat; line: string; accepted: string | null }[];
}

const cases = JSON.parse(readFileSync("contracts/calculator-cases.json", "utf8")) as Cases;

const ctx = (format: CalculationFormat): CalculationContext => ({
  format,
  currencies: cases.currencies
});

describe("the shared calculation contract, in the plugin", () => {
  for (const { name, format, line, result } of cases.lines) {
    it(`${name ?? line} (${format})`, () => {
      expect(calculateLine(line, ctx(format))?.text ?? null).toBe(result);
    });
  }

  for (const { name, format, text, results } of cases.documents) {
    it(name, () => {
      const found = calculationLines(text, ctx(format)).map(({ line, result }) => [line, result]);
      expect(found).toEqual(results);
    });
  }

  for (const { format, line, accepted } of cases.accept) {
    it(`accepts ${JSON.stringify(line)}`, () => {
      expect(acceptedLine(line, ctx(format))).toBe(accepted);
    });
  }

  it("reads the same currencies and converts with the same units", () => {
    expect(cases.signs).toEqual(CALCULATION_SIGNS);
    expect(cases.currencies).toEqual([...CURRENCY_CODES]);
    expect(cases.units).toEqual(CALCULATION_UNITS);
  });

  it("writes numbers with the shared marks", () => {
    for (const [format, { group, decimal }] of Object.entries(cases.formats)) {
      const written = calculateLine("1234567 + 0,5 =", ctx(format as CalculationFormat))?.text;
      // `0,5` is a half in the comma formats and five tenths' worth of
      // thousands nowhere: the point formats read it as 0.5 too (rule 4).
      expect(written).toBe(`1${group}234${group}567${decimal}5`);
    }
  });
});
