import { describe, expect, it } from "vitest";
import { numberFormatFor } from "./amounts";
import type { FormulaContext } from "./formulas";
import { MAX_SELECTION_CHARS, selectionTotal } from "./selection-total";

const ctx: FormulaContext = {
  format: numberFormatFor("comma", "en"),
  defaultCurrency: "",
  rates: null
};

describe("selectionTotal", () => {
  it("adds one amount per line", () => {
    const total = selectionTotal("Groceries 300 €\nCar 20 €", ctx);
    expect(total).toMatchObject({ count: 2 });
    expect(total?.text?.replace(/\u00a0/g, " ")).toBe("320 €");
  });

  it("has nothing to show for fewer amounts than asked for", () => {
    expect(selectionTotal("Groceries 300 €", ctx)).toBeNull();
    expect(selectionTotal("Groceries 300 €", ctx, 1)).toMatchObject({ count: 1 });
    expect(selectionTotal("", ctx, 1)).toBeNull();
  });

  it("does not read a selection too long to be figures", () => {
    const long = "1\n".repeat(MAX_SELECTION_CHARS);
    expect(selectionTotal(long, ctx)).toBeNull();
  });

  it("has no text for currencies it cannot put together", () => {
    const total = selectionTotal("300 €\n20 $", ctx);
    expect(total?.text?.replace(/\u00a0/g, " ")).toBe("300 € + 20 $");
  });
});
