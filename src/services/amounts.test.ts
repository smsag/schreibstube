import { describe, expect, it } from "vitest";
import {
  amountsInText,
  normalizeCurrency,
  normalizeNumberStyle,
  numberFormatFor,
  readCell,
  readNumber
} from "./amounts";

const de = numberFormatFor("comma", "en");
const en = numberFormatFor("point", "en");
const fr = numberFormatFor("space", "en");

function one(text: string, format = de) {
  const reading = readCell(text, format);
  return reading.kind === "amount" ? reading.amount : reading.kind;
}

describe("numberFormatFor", () => {
  it("reads the fixed formats' decimal marks", () => {
    expect(de.decimal).toBe(",");
    expect(en.decimal).toBe(".");
    expect(fr).toMatchObject({ decimal: ",", spaceGroups: true });
    expect(numberFormatFor("apostrophe", "en").decimal).toBe(".");
  });

  it("follows Obsidian's language when automatic", () => {
    expect(numberFormatFor("auto", "de").decimal).toBe(",");
    expect(numberFormatFor("auto", "en-GB").decimal).toBe(".");
    expect(numberFormatFor("auto", "fr").spaceGroups).toBe(true);
  });

  it("falls back to English for a language Intl cannot read", () => {
    expect(numberFormatFor("auto", "not a language!").locale).toBe("en");
    expect(numberFormatFor("auto", "  ").locale).toBe("en");
  });
});

describe("normalizers", () => {
  it("keeps a known number style and replaces anything else with automatic", () => {
    expect(normalizeNumberStyle("comma")).toBe("comma");
    expect(normalizeNumberStyle("dots")).toBe("auto");
    expect(normalizeNumberStyle(3)).toBe("auto");
  });

  it("keeps a known currency code, in capitals, and nothing else", () => {
    expect(normalizeCurrency(" eur ")).toBe("EUR");
    expect(normalizeCurrency("XYZ")).toBe("");
    expect(normalizeCurrency(null)).toBe("");
  });
});

describe("readNumber", () => {
  it("takes the last of two marks for the decimal, whatever the format", () => {
    expect(readNumber("1.234,50", en)).toEqual({ value: 1234.5, decimals: 2 });
    expect(readNumber("1,234.50", de)).toEqual({ value: 1234.5, decimals: 2 });
  });

  it("reads a mark that occurs more than once as grouping", () => {
    expect(readNumber("1.234.567", en)).toEqual({ value: 1234567, decimals: 0 });
  });

  it("reads a single mark not followed by three digits as the decimal", () => {
    expect(readNumber("20.50", de)?.value).toBe(20.5);
    expect(readNumber("1,5", en)?.value).toBe(1.5);
  });

  it("never groups a zero", () => {
    expect(readNumber("0,125", en)?.value).toBe(0.125);
  });

  it("lets the format decide the one ambiguous case", () => {
    expect(readNumber("1.234", de)?.value).toBe(1234);
    expect(readNumber("1.234", en)?.value).toBe(1.234);
    expect(readNumber("1,234", de)?.value).toBe(1.234);
    expect(readNumber("1,234", en)?.value).toBe(1234);
  });

  it("takes the point for the decimal when a space or an apostrophe groups already", () => {
    expect(readNumber("1'234.567", de)?.value).toBe(1234.567);
  });

  it("refuses separators that contradict each other", () => {
    expect(readNumber("26.09.2026", de)).toBeNull();
    expect(readNumber("1234.567", de)).toBeNull();
    expect(readNumber("1.234'567", de)).toBeNull();
  });
});

describe("readCell", () => {
  it("reads the amounts of the concept", () => {
    expect(one("300 €")).toEqual({ value: 300, currency: "EUR", decimals: 0 });
    expect(one("€ 20")).toEqual({ value: 20, currency: "EUR", decimals: 0 });
    expect(one("1.234,50 €")).toEqual({ value: 1234.5, currency: "EUR", decimals: 2 });
    expect(one("20,- €")).toEqual({ value: 20, currency: "EUR", decimals: 0 });
    expect(one("-20 €")).toEqual({ value: -20, currency: "EUR", decimals: 0 });
    expect(one("€-20")).toEqual({ value: -20, currency: "EUR", decimals: 0 });
  });

  it("knows currency signs and codes, and not three-letter words", () => {
    expect(one("$20", en)).toMatchObject({ currency: "USD" });
    expect(one("R$ 20", en)).toMatchObject({ currency: "BRL" });
    expect(one("12 CHF")).toMatchObject({ currency: "CHF" });
    expect(one("20 usd")).toMatchObject({ value: 20, currency: null });
    expect(one("20 PDF")).toMatchObject({ value: 20, currency: null });
  });

  it("reads grouping with spaces that cannot break, and plain spaces where the format groups so", () => {
    expect(one("1\u202f234,50 €")).toMatchObject({ value: 1234.5 });
    expect(one("1 234,50 €", fr)).toMatchObject({ value: 1234.5 });
    expect(one("1'234.50 CHF", en)).toMatchObject({ value: 1234.5 });
  });

  it("leaves out numbers glued to words, times, paths and percentages", () => {
    expect(one("A4")).toBe("unreadable");
    expect(one("12:30")).toBe("unreadable");
    expect(one("5 %")).toBe("unreadable");
    expect(one("Seite-3")).toBe("unreadable");
    expect(one("26.09.2026")).toBe("unreadable");
  });

  it("takes the priced number, and the last of several", () => {
    expect(one("2 × Milch 1,50 €")).toMatchObject({ value: 1.5 });
    expect(one("3 items")).toMatchObject({ value: 3, currency: null });
  });

  it("passes over quoted amounts on purpose, in every kind of quotes", () => {
    for (const quoted of ['"300 €"', "„300 €“", "“300 €”", "«300 €»", "»300 €«"]) {
      expect(one(quoted)).toBe("quoted");
    }
    expect(one('"old" 300 €')).toMatchObject({ value: 300 });
  });

  it("calls a cell without letters or digits empty, and text without an amount unreadable", () => {
    expect(one("")).toBe("empty");
    expect(one(" – ")).toBe("empty");
    expect(one("n/a")).toBe("unreadable");
  });

  it("does not read a formula as an amount", () => {
    expect(one("=sum(fixed: 342,17 €)")).toBe("empty");
  });
});

describe("amountsInText", () => {
  it("reads one amount per line and skips lines without one", () => {
    const text = "Groceries 300 €\nCar 20 €\n\nNotes without figures";
    expect(amountsInText(text, de).map((a) => a.value)).toEqual([300, 20]);
  });

  it("does not read a table's header row, whatever its labels say", () => {
    const table = "| Posten | Betrag 2024 |\n|---|---|\n| Miete | 850 € |\n| Auto | 20 € |";
    expect(amountsInText(table, de).map((a) => a.value)).toEqual([850, 20]);
  });

  it("takes only figures from prose when asked to", () => {
    const prose = "Im Jahr 2024 schrieb sie das Buch,\nund Kapitel 3 kam zuletzt.";
    expect(amountsInText(prose, de)).toHaveLength(2);
    expect(amountsInText(prose, de, true)).toEqual([]);
    const figures = "Groceries 300\nCar 20.\n| Bike | 10 |\nFee 5 € extra";
    expect(amountsInText(figures, de, true).map((a) => a.value)).toEqual([300, 20, 10, 5]);
  });

  it("reads table rows as lines, without their formula cells", () => {
    const text = "| Groceries | 300 € |\n| Car | 20 € |\n| Total | =sum(fixed: 320 €) |";
    expect(amountsInText(text, de).map((a) => a.value)).toEqual([300, 20]);
  });
});
