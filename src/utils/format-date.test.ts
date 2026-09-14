import { describe, expect, it } from "vitest";
import { formatIsoMinutes } from "./format-date";

describe("formatIsoMinutes", () => {
  it("renders to the minute in UTC", () => {
    expect(formatIsoMinutes("2026-09-14T18:54:56.000Z")).toBe("2026-09-14 18:54");
  });

  it("normalises an offset to UTC", () => {
    expect(formatIsoMinutes("2026-09-14T20:54:00+02:00")).toBe("2026-09-14 18:54");
  });

  it("passes an unparseable value through unchanged", () => {
    expect(formatIsoMinutes("gestern")).toBe("gestern");
  });

  it("renders nothing for nothing", () => {
    expect(formatIsoMinutes(null)).toBe("");
    expect(formatIsoMinutes(undefined)).toBe("");
    expect(formatIsoMinutes("")).toBe("");
  });
});
