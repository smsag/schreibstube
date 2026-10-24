import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatIsoMinutes } from "./format-date";

describe("formatIsoMinutes", () => {
  const zone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "Europe/Berlin";
  });
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("renders to the minute in this device's time zone", () => {
    expect(formatIsoMinutes("2026-09-14T18:54:56.000Z")).toBe("2026-09-14 20:54");
    expect(formatIsoMinutes("2026-12-31T23:30:00.000Z")).toBe("2027-01-01 00:30");
  });

  it("reads an offset as the moment it names", () => {
    expect(formatIsoMinutes("2026-09-14T20:54:00+02:00")).toBe("2026-09-14 20:54");
    process.env.TZ = "America/Los_Angeles";
    expect(formatIsoMinutes("2026-09-14T20:54:00+02:00")).toBe("2026-09-14 11:54");
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
