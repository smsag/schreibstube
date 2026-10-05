import { describe, expect, it } from "vitest";
import {
  convert,
  MAX_RATES_BYTES,
  normalizeExchangeRates,
  parseEcbRates,
  RATES_MAX_AGE_MS,
  ratesSizeProblem,
  ratesStale
} from "./exchange-rates";

const ECB = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
  <Cube>
    <Cube time='2026-09-26'>
      <Cube currency='USD' rate='1.0712'/>
      <Cube currency='JPY' rate='158.30'/>
      <Cube currency='XXX' rate='2'/>
      <Cube currency='GBP' rate='-1'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("parseEcbRates", () => {
  it("reads the day and the rates of known currencies", () => {
    expect(parseEcbRates(ECB, 5)).toEqual({
      date: "2026-09-26",
      fetchedAt: 5,
      rates: { USD: 1.0712, JPY: 158.3 }
    });
  });

  it("refuses a file that is not the bank's", () => {
    expect(parseEcbRates("<html>Maintenance</html>", 0)).toBeNull();
    expect(parseEcbRates("<Cube time='2026-09-26'></Cube>", 0)).toBeNull();
    expect(parseEcbRates("<Cube time='yesterday'><Cube currency='USD' rate='1'/>", 0)).toBeNull();
    expect(parseEcbRates(ECB + " ".repeat(MAX_RATES_BYTES), 0)).toBeNull();
  });
});

describe("ratesSizeProblem", () => {
  it("passes the bank's file", () => {
    expect(ratesSizeProblem({ "content-length": "1500" }, ECB)).toBeNull();
  });

  it("refuses an answer that declares or holds more than a list of rates", () => {
    const declared = { "content-length": String(MAX_RATES_BYTES + 1) };
    expect(ratesSizeProblem(declared, ECB)).not.toBeNull();
    expect(ratesSizeProblem(undefined, new ArrayBuffer(MAX_RATES_BYTES + 1))).not.toBeNull();
  });
});

describe("normalizeExchangeRates", () => {
  it("keeps rates as they were stored", () => {
    const stored = { date: "2026-09-26", fetchedAt: 10, rates: { USD: 1.07 } };
    expect(normalizeExchangeRates(stored)).toEqual(stored);
  });

  it("drops what a hand edit could have broken", () => {
    expect(normalizeExchangeRates(null)).toBeNull();
    expect(normalizeExchangeRates({ date: "x", fetchedAt: 1, rates: { USD: 1 } })).toBeNull();
    expect(normalizeExchangeRates({ date: "2026-09-26", fetchedAt: "1", rates: {} })).toBeNull();
    expect(normalizeExchangeRates({ date: "2026-09-26", fetchedAt: 1, rates: null })).toBeNull();
    expect(
      normalizeExchangeRates({ date: "2026-09-26", fetchedAt: 1, rates: { USD: 0, EVIL: 2 } })
    ).toBeNull();
    expect(
      normalizeExchangeRates({ date: "2026-09-26", fetchedAt: 1, rates: { USD: 1, GBP: "x" } })
    ).toEqual({ date: "2026-09-26", fetchedAt: 1, rates: { USD: 1 } });
  });
});

describe("ratesStale", () => {
  const rates = { date: "2026-09-26", fetchedAt: 1_000, rates: { USD: 1 } };

  it("asks again after half a day, for no rates, and for a clock that went back", () => {
    expect(ratesStale(rates, 1_000 + RATES_MAX_AGE_MS)).toBe(false);
    expect(ratesStale(rates, 1_001 + RATES_MAX_AGE_MS)).toBe(true);
    expect(ratesStale(null, 0)).toBe(true);
    expect(ratesStale(rates, 999)).toBe(true);
  });
});

describe("convert", () => {
  const rates = { date: "2026-09-26", fetchedAt: 0, rates: { USD: 1.25, GBP: 0.8 } };

  it("converts from and to the euro, and between two others through it", () => {
    expect(convert(10, "EUR", "USD", rates)).toBe(12.5);
    expect(convert(12.5, "USD", "EUR", rates)).toBe(10);
    expect(convert(8, "GBP", "USD", rates)).toBeCloseTo(12.5);
    expect(convert(8, "GBP", "GBP", rates)).toBe(8);
  });

  it("has no answer for a currency without a rate", () => {
    expect(convert(1, "JPY", "EUR", rates)).toBeNull();
  });
});
