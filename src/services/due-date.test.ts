import { describe, expect, it } from "vitest";
import {
  dueDateOf,
  dueState,
  formatDueDate,
  formatDueDateLong,
  localIsoDate,
  MAX_DUE_LENGTH,
  type DueDate
} from "./due-date";

function due(value: unknown): DueDate | null {
  return dueDateOf({ schreibstubeDue: value });
}

describe("dueDateOf", () => {
  it("reads a date property", () => {
    expect(due("2026-10-12")).toEqual({ iso: "2026-10-12", year: 2026, month: 10, day: 12 });
  });

  it("reads a date-and-time property as its day, whatever the time or offset", () => {
    for (const value of [
      "2026-10-12T09:30",
      "2026-10-12T23:59:59",
      "2026-10-12 09:30",
      "2026-10-12T09:30:00.000Z",
      "2026-10-12T00:30+02:00",
      "2026-10-12T00:30-0500"
    ]) {
      expect(due(value)?.iso).toBe("2026-10-12");
    }
  });

  it("forgives the spaces a hand-edited value carries", () => {
    expect(due("  2026-10-12 ")?.iso).toBe("2026-10-12");
  });

  it("refuses a day that is not on the calendar", () => {
    for (const value of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-10-00"]) {
      expect(due(value)).toBeNull();
    }
    expect(due("2028-02-29")?.iso).toBe("2028-02-29");
  });

  it("shows nothing for a value that is not a date", () => {
    for (const value of [
      undefined,
      null,
      "",
      "tomorrow",
      "12.10.2026",
      "2026-10-12T",
      "2026-10-12x",
      "2026-1-2",
      20261012,
      true,
      ["2026-10-12"],
      { date: "2026-10-12" }
    ]) {
      expect(due(value)).toBeNull();
    }
  });

  it("does not read a value past the bound", () => {
    expect(due("2026-10-12" + " ".repeat(MAX_DUE_LENGTH))).not.toBeNull();
    expect(due("2026-10-12T09:30:00." + "0".repeat(MAX_DUE_LENGTH))).toBeNull();
  });

  it("has nothing to say without frontmatter", () => {
    for (const frontmatter of [undefined, null, "text", 3, {}]) {
      expect(dueDateOf(frontmatter)).toBeNull();
    }
  });
});

describe("localIsoDate", () => {
  it("writes the local calendar day, padded", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localIsoDate(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});

describe("dueState", () => {
  const day = due("2026-10-12") as DueDate;

  it("is today on the day, overdue after it and upcoming before it", () => {
    expect(dueState(day, "2026-10-12")).toBe("today");
    expect(dueState(day, "2026-10-13")).toBe("overdue");
    expect(dueState(day, "2027-01-01")).toBe("overdue");
    expect(dueState(day, "2026-10-11")).toBe("upcoming");
    expect(dueState(day, "2025-12-31")).toBe("upcoming");
  });
});

describe("formatDueDate", () => {
  const day = due("2026-10-12") as DueDate;

  it("leaves the year out when it is this one", () => {
    expect(formatDueDate(day, "2026-01-01", "en")).toBe("Oct 12");
    expect(formatDueDate(day, "2026-01-01", "de")).toBe("12. Okt.");
  });

  it("names the year when it is not this one, ahead or behind", () => {
    expect(formatDueDate(day, "2025-12-31", "en")).toBe("Oct 12, 2026");
    expect(formatDueDate(day, "2027-01-01", "de")).toBe("12. Okt. 2026");
  });

  it("writes the day the note names, whatever the zone", () => {
    expect(formatDueDate(due("2026-01-01T00:30+14:00") as DueDate, "2026-06-01", "en")).toBe(
      "Jan 1"
    );
  });
});

describe("formatDueDateLong", () => {
  it("writes the whole day", () => {
    const day = due("2026-10-12") as DueDate;
    expect(formatDueDateLong(day, "en")).toBe("October 12, 2026");
    expect(formatDueDateLong(day, "de")).toBe("12. Oktober 2026");
  });
});
