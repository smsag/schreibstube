import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATE_FORMAT,
  formatDate,
  normalizeDateFormat,
  propertyKindOf,
  todayForInput,
  todayStrings,
  todayValue,
  type TodayStrings
} from "./today-value";

const today: TodayStrings = {
  isoDate: "2026-09-18",
  isoDateTime: "2026-09-18T09:05",
  text: "18.09.2026"
};

describe("todayValue", () => {
  it("writes ISO into date and date-time properties whatever the format", () => {
    expect(todayValue("date", "", today)).toBe("2026-09-18");
    expect(todayValue("datetime", null, today)).toBe("2026-09-18T09:05");
  });

  it("writes the chosen format into text", () => {
    expect(todayValue("text", "", today)).toBe("18.09.2026");
  });

  it("keeps ISO in a text property that already holds an ISO date", () => {
    expect(todayValue("text", "2025-01-01", today)).toBe("2026-09-18");
  });

  it("appends to a list instead of replacing it, once", () => {
    expect(todayValue("multitext", ["a"], today)).toEqual(["a", "18.09.2026"]);
    expect(todayValue("multitext", ["18.09.2026"], today)).toEqual(["18.09.2026"]);
    expect(todayValue("aliases", "solo", today)).toEqual(["solo", "18.09.2026"]);
    expect(todayValue("multitext", null, today)).toEqual(["18.09.2026"]);
  });

  it("offers nothing where a date makes no sense", () => {
    expect(todayValue("number", 3, today)).toBeUndefined();
    expect(todayValue("checkbox", false, today)).toBeUndefined();
    expect(todayValue("tags", ["x"], today)).toBeUndefined();
  });

  it("judges an untyped key by what it holds", () => {
    expect(todayValue("unknown", ["a"], today)).toEqual(["a", "18.09.2026"]);
    expect(todayValue("unknown", undefined, today)).toBe("18.09.2026");
  });
});

describe("propertyKindOf", () => {
  it("accepts Obsidian's type names and nothing else", () => {
    expect(propertyKindOf("date")).toBe("date");
    expect(propertyKindOf("something-new")).toBe("unknown");
    expect(propertyKindOf(null)).toBe("unknown");
  });
});

describe("todayForInput", () => {
  it("gives date inputs ISO and text inputs the format", () => {
    expect(todayForInput("date", today)).toBe("2026-09-18");
    expect(todayForInput("datetime-local", today)).toBe("2026-09-18T09:05");
    expect(todayForInput("text", today)).toBe("18.09.2026");
  });
});

describe("formatDate", () => {
  const date = new Date(2026, 8, 4, 7, 5, 9);

  it("writes the numeric tokens", () => {
    expect(formatDate(date, "YYYY-MM-DD HH:mm:ss", "en")).toBe("2026-09-04 07:05:09");
    expect(formatDate(date, "D.M.YY H", "en")).toBe("4.9.26 7");
  });

  it("names months and weekdays in the locale", () => {
    expect(formatDate(date, "dddd, D. MMMM YYYY", "de")).toBe("Freitag, 4. September 2026");
    expect(formatDate(date, "ddd MMM", "en")).toBe("Fri Sep");
  });

  it("keeps bracketed text as written", () => {
    expect(formatDate(date, "[Stand] DD.MM.", "de")).toBe("Stand 04.09.");
  });

  it("builds all three shapes at once", () => {
    expect(todayStrings(date, "DD.MM.YYYY", "de")).toEqual({
      isoDate: "2026-09-04",
      isoDateTime: "2026-09-04T07:05",
      text: "04.09.2026"
    });
  });
});

describe("normalizeDateFormat", () => {
  it("keeps a sensible format and falls back otherwise", () => {
    expect(normalizeDateFormat(" DD.MM.YYYY ")).toBe("DD.MM.YYYY");
    expect(normalizeDateFormat("")).toBe(DEFAULT_DATE_FORMAT);
    expect(normalizeDateFormat(42)).toBe(DEFAULT_DATE_FORMAT);
    expect(normalizeDateFormat("x".repeat(41))).toBe(DEFAULT_DATE_FORMAT);
  });
});
