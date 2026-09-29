import { describe, expect, it } from "vitest";
import { numberFormatFor, type Amount } from "./amounts";
import type { ExchangeRates } from "./exchange-rates";
import {
  compute,
  formatAmount,
  formatRateDate,
  outcomeText,
  type FormulaContext
} from "./formulas";

const de = numberFormatFor("comma", "en");
const en = numberFormatFor("point", "en");
const rates: ExchangeRates = { date: "2026-09-26", fetchedAt: 0, rates: { USD: 1.25, GBP: 0.8 } };

function ctx(patch: Partial<FormulaContext> = {}): FormulaContext {
  return { format: de, defaultCurrency: "", rates: null, ...patch };
}

function eur(value: number, decimals = 0): Amount {
  return { value, currency: "EUR", decimals };
}

const text = (outcome: ReturnType<typeof compute>, format = de) =>
  outcomeText(outcome, format)?.replace(/\u00a0|\u202f/g, " ");

describe("compute over a very long column", () => {
  it("takes more amounts than a call may carry as arguments", () => {
    const amounts = Array.from({ length: 200_000 }, (_, i) => eur(i % 1000, i % 3));
    expect(compute("max", amounts, ctx())).toMatchObject({ value: 999, decimals: 2 });
    expect(compute("min", amounts, ctx())).toMatchObject({ value: 0 });
    expect(compute("sum", amounts, ctx()).kind).toBe("value");
  });
});

describe("compute in one currency", () => {
  const amounts = [eur(300), eur(20), eur(10)];

  it("does every operation", () => {
    expect(text(compute("sum", amounts, ctx()))).toBe("330 €");
    expect(text(compute("avg", amounts, ctx()))).toBe("110 €");
    expect(text(compute("median", amounts, ctx()))).toBe("20 €");
    expect(text(compute("count", amounts, ctx()))).toBe("3");
    expect(text(compute("min", amounts, ctx()))).toBe("10 €");
    expect(text(compute("max", amounts, ctx()))).toBe("300 €");
  });

  it("takes the middle of two for an even median, with the cents that needs", () => {
    expect(text(compute("median", [eur(1), eur(2)], ctx()))).toBe("1,50 €");
  });

  it("keeps the cents the inputs were written with", () => {
    expect(text(compute("sum", [eur(1.5, 2), eur(2)], ctx()))).toBe("3,50 €");
  });

  it("counts bare numbers in the column's one currency", () => {
    const outcome = compute("sum", [eur(300), { value: 20, currency: null, decimals: 0 }], ctx());
    expect(text(outcome)).toBe("320 €");
  });

  it("writes bare numbers bare, or in the default currency", () => {
    const bare = [{ value: 1200, currency: null, decimals: 0 }];
    expect(text(compute("sum", bare, ctx()))).toBe("1.200");
    expect(text(compute("sum", bare, ctx({ defaultCurrency: "EUR" })))).toBe("1.200 €");
  });

  it("sums nothing to zero, and has no average of nothing", () => {
    expect(text(compute("sum", [], ctx()))).toBe("0");
    expect(compute("avg", [], ctx())).toEqual({ kind: "none" });
    expect(text(compute("count", [], ctx()))).toBe("0");
  });
});

describe("compute in several currencies", () => {
  const mixed = [eur(300), { value: 25, currency: "USD", decimals: 0 }];

  it("converts into the default currency, and says at which day's rates", () => {
    const outcome = compute("sum", mixed, ctx({ defaultCurrency: "EUR", rates }));
    expect(text(outcome)).toBe("≈ 320,00 € · ECB 26.09.2026");
  });

  it("converts through the euro between two other currencies", () => {
    const outcome = compute(
      "sum",
      [{ value: 8, currency: "GBP", decimals: 0 }, mixed[1]!],
      ctx({ defaultCurrency: "USD", rates })
    );
    expect(outcome).toMatchObject({ kind: "value", currency: "USD" });
    expect(outcome.kind === "value" && outcome.value).toBeCloseTo(37.5);
  });

  it("gives subtotals for a sum when it cannot convert", () => {
    expect(text(compute("sum", mixed, ctx()))).toBe("300 € + 25 $");
    // A rate missing for one of them is as good as no rates.
    const yen = [eur(1), { value: 5, currency: "JPY", decimals: 0 }];
    expect(compute("sum", yen, ctx({ defaultCurrency: "EUR", rates }))).toMatchObject({
      kind: "subtotals"
    });
  });

  it("calls the currencies mixed for anything but a sum", () => {
    expect(compute("avg", mixed, ctx())).toEqual({ kind: "mixed" });
    expect(outcomeText({ kind: "mixed" }, de)).toBeNull();
    expect(outcomeText({ kind: "none" }, de)).toBeNull();
  });

  it("counts them all the same", () => {
    expect(text(compute("count", mixed, ctx()))).toBe("2");
  });
});

describe("formatting", () => {
  it("writes an amount the way the format does", () => {
    expect(formatAmount(1234.5, "USD", 2, en)).toBe("$1,234.50");
    expect(formatAmount(1234.5, null, 1, de)).toBe("1.234,5");
  });

  it("writes the rates' day the way the format's language does", () => {
    expect(formatRateDate("2026-09-26", de)).toBe("26.09.2026");
    expect(formatRateDate("2026-09-26", en)).toBe("09/26/2026");
  });
});
