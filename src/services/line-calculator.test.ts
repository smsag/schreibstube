import { describe, expect, it } from "vitest";
import { CURRENCY_CODES, numberFormatFor } from "./amounts";
import type { ExchangeRates } from "./exchange-rates";
import {
  MAX_CALCULATION_LINE,
  calculateLine,
  calculationFormatFor,
  type CalculationContext
} from "./line-calculator";

/** What only Schreibstube does with a calculation line; the shared rule is in the contract test. */

const RATES: ExchangeRates = {
  date: "2026-09-26",
  fetchedAt: 0,
  rates: { USD: 1.1, GBP: 0.85 }
};

const plain: CalculationContext = { format: "comma", currencies: CURRENCY_CODES };
const converting: CalculationContext = {
  ...plain,
  conversion: { into: "EUR", rates: RATES, day: "26.09.2026" }
};

describe("mixed currencies", () => {
  it("show nothing without conversion, as in the other app", () => {
    expect(calculateLine("300 € + 22 $ =", plain)).toBeNull();
  });

  it("are converted into the default currency, saying whose rates", () => {
    expect(calculateLine("300 € + 22 $ =", converting)?.text).toBe("≈ 320,00 € · ECB 26.09.2026");
  });

  it("keep the conversion's mark through what follows", () => {
    expect(calculateLine("(300 € + 22 $) * 2 =", converting)?.text).toBe(
      "≈ 640,00 € · ECB 26.09.2026"
    );
  });

  it("are written in the default currency's code when no amount named it", () => {
    expect(calculateLine("22 $ + 17 £ =", converting)?.text).toBe("≈ 40,00 EUR · ECB 26.09.2026");
  });

  it("show nothing when a rate is missing", () => {
    expect(calculateLine("300 € + 5 CHF =", converting)).toBeNull();
  });

  it("leave a sum in one currency exact, without the mark", () => {
    expect(calculateLine("300 € + 20 € =", converting)?.text).toBe("320,00 €");
  });
});

describe("a line it will not evaluate", () => {
  it("is too long to be a sum anyone typed", () => {
    const line = `${"1 + ".repeat(MAX_CALCULATION_LINE / 4)}1 =`;
    expect(line.length).toBeGreaterThan(MAX_CALCULATION_LINE);
    expect(calculateLine(line, plain)).toBeNull();
  });

  it("nests deeper than anyone writes by hand", () => {
    expect(calculateLine(`${"(".repeat(33)}1${")".repeat(33)} + 1 =`, plain)).toBeNull();
    expect(calculateLine(`${"(".repeat(32)}1${")".repeat(32)} + 1 =`, plain)?.text).toBe("2");
  });
});

describe("the number format a calculation writes in", () => {
  it("follows the setting, automatic included", () => {
    expect(calculationFormatFor(numberFormatFor("comma", "en"))).toBe("comma");
    expect(calculationFormatFor(numberFormatFor("point", "de"))).toBe("point");
    expect(calculationFormatFor(numberFormatFor("space", "de"))).toBe("space");
    expect(calculationFormatFor(numberFormatFor("apostrophe", "de"))).toBe("apostrophe");
    expect(calculationFormatFor(numberFormatFor("auto", "de"))).toBe("comma");
    expect(calculationFormatFor(numberFormatFor("auto", "en"))).toBe("point");
    expect(calculationFormatFor(numberFormatFor("auto", "fr"))).toBe("space");
    expect(calculationFormatFor(numberFormatFor("auto", "de-CH"))).toBe("apostrophe");
  });
});
