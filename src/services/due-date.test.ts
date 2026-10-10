import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUE_KEYS,
  dueDateOf,
  dueDrawKey,
  dueKeysRead,
  dueLabel,
  dueState,
  MAX_DUE_CONFLICTS_NAMED,
  MAX_DUE_KEY_LENGTH,
  MAX_DUE_LENGTH,
  MAX_DUE_SYNONYMS,
  moveDue,
  normalizeDueProperty,
  normalizeDueSynonyms,
  planDueMove,
  tallyDueMoves,
  type DueDate,
  type DueKeys,
  type LocalDayOf
} from "./due-date";

/** A clock in a fixed zone, so a test does not depend on the machine's. */
function zone(offsetMinutes: number): LocalDayOf {
  return (ms) => new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

const berlinSummer = zone(120);

function due(value: unknown, dayOf: LocalDayOf = berlinSummer): DueDate | null {
  return dueDateOf({ schreibstubeDue: value }, DEFAULT_DUE_KEYS, dayOf);
}

describe("dueDateOf", () => {
  it("reads a date property", () => {
    expect(due("2026-10-12")).toEqual({ iso: "2026-10-12", year: 2026, month: 10, day: 12 });
  });

  it("reads a date-and-time without a zone as the day it names", () => {
    for (const value of ["2026-10-12T00:00", "2026-10-12T23:59:59", "2026-10-12 09:30:00.5"]) {
      expect(due(value)?.iso).toBe("2026-10-12");
    }
  });

  it("reads an instant as the local day it falls on", () => {
    // Local midnight on the 12th in Berlin, written by a script as UTC.
    expect(due("2026-10-11T22:00:00.000Z")?.iso).toBe("2026-10-12");
    expect(due("2026-10-12T00:30+02:00")?.iso).toBe("2026-10-12");
    expect(due("2026-10-12T00:30+0200")?.iso).toBe("2026-10-12");
    expect(due("2026-10-12T20:00-05:00")?.iso).toBe("2026-10-13");
    expect(due("2026-10-11T22:00:00Z", zone(-300))?.iso).toBe("2026-10-11");
    expect(due("2026-12-31T23:30Z")?.iso).toBe("2027-01-01");
  });

  it("forgives the spaces a hand-edited value carries", () => {
    expect(due("  2026-10-12 ")?.iso).toBe("2026-10-12");
  });

  it("refuses a day that is not on the calendar", () => {
    for (const value of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-10-00"]) {
      expect(due(value)).toBeNull();
    }
    expect(due("2028-02-29")?.iso).toBe("2028-02-29");
    expect(due("2000-02-29")?.iso).toBe("2000-02-29");
    expect(due("2100-02-29")).toBeNull();
  });

  it("refuses a time or an offset that is not on the clock", () => {
    for (const value of [
      "2026-10-12T24:00",
      "2026-10-12T25:99",
      "2026-10-12T09:60",
      "2026-10-12T09:30:61",
      "2026-10-12T09:30+15:00",
      "2026-10-12T09:30+99:99",
      "2026-10-12T09:30+02:60"
    ]) {
      expect(due(value)).toBeNull();
    }
  });

  it("takes a year below 1000 for a typo rather than a date", () => {
    for (const value of ["0026-10-12", "0000-02-29", "0999-12-31"]) {
      expect(due(value)).toBeNull();
    }
    expect(due("1000-01-01")?.iso).toBe("1000-01-01");
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

  it("bounds the value before reading it, spaces included", () => {
    expect(due("2026-10-12".padEnd(MAX_DUE_LENGTH))).not.toBeNull();
    expect(due("2026-10-12".padEnd(MAX_DUE_LENGTH + 1))).toBeNull();
    expect(due("2026-10-12" + " ".repeat(1_000_000))).toBeNull();
  });

  it("has nothing to say without frontmatter", () => {
    for (const frontmatter of [undefined, null, "text", 3, {}]) {
      expect(dueDateOf(frontmatter)).toBeNull();
    }
  });
});

describe("the keys a due day is read from", () => {
  const zieldatum: DueKeys = { property: "Zieldatum", synonyms: ["deadline", "due"] };
  const iso = (frontmatter: Record<string, unknown>, keys: DueKeys = zieldatum) =>
    dueDateOf(frontmatter, keys, berlinSummer)?.iso ?? null;

  it("reads the named property instead of schreibstubeDue", () => {
    expect(iso({ Zieldatum: "2026-10-12" })).toBe("2026-10-12");
    expect(iso({ Zieldatum: "2026-10-12" }, DEFAULT_DUE_KEYS)).toBeNull();
  });

  it("prefers the property, then the synonyms in order, then schreibstubeDue", () => {
    const all = {
      Zieldatum: "2026-10-01",
      deadline: "2026-10-02",
      due: "2026-10-03",
      schreibstubeDue: "2026-10-04"
    };
    expect(iso(all)).toBe("2026-10-01");
    expect(iso({ ...all, Zieldatum: undefined })).toBe("2026-10-02");
    expect(iso({ due: "2026-10-03", schreibstubeDue: "2026-10-04" })).toBe("2026-10-03");
    expect(iso({ schreibstubeDue: "2026-10-04" })).toBe("2026-10-04");
  });

  it("passes over a key that holds no real day for the next one", () => {
    expect(iso({ Zieldatum: "soon", deadline: "2026-02-30", due: "2026-10-03" })).toBe(
      "2026-10-03"
    );
  });

  it("reads only the note's own keys", () => {
    const keys = { property: "constructor", synonyms: ["toString"] };
    expect(iso({}, keys)).toBeNull();
    expect(iso({ constructor: "2026-10-12" }, keys)).toBe("2026-10-12");
  });

  it("tries each key once, schreibstubeDue last", () => {
    expect(dueKeysRead(DEFAULT_DUE_KEYS)).toEqual(["schreibstubeDue"]);
    expect(dueKeysRead({ property: "Zieldatum", synonyms: ["schreibstubeDue", "due"] })).toEqual([
      "Zieldatum",
      "schreibstubeDue",
      "due"
    ]);
    expect(dueKeysRead(zieldatum)).toEqual(["Zieldatum", "deadline", "due", "schreibstubeDue"]);
  });
});

describe("normalizeDueProperty", () => {
  it("keeps a typed name, trimmed", () => {
    expect(normalizeDueProperty("  Zieldatum ")).toBe("Zieldatum");
    expect(normalizeDueProperty("Fällig am")).toBe("Fällig am");
  });

  it("falls back to schreibstubeDue for anything that is no usable name", () => {
    for (const value of [undefined, null, 3, ["due"], "", "   ", "a\nb", "tab\there"]) {
      expect(normalizeDueProperty(value)).toBe("schreibstubeDue");
    }
    expect(normalizeDueProperty("k".repeat(MAX_DUE_KEY_LENGTH))).toBe(
      "k".repeat(MAX_DUE_KEY_LENGTH)
    );
    expect(normalizeDueProperty("k".repeat(MAX_DUE_KEY_LENGTH + 1))).toBe("schreibstubeDue");
  });
});

describe("normalizeDueSynonyms", () => {
  it("reads a list or the field's text, one per line or comma", () => {
    expect(normalizeDueSynonyms(["due", " deadline "], "Zieldatum")).toEqual(["due", "deadline"]);
    expect(normalizeDueSynonyms("due\n deadline, Fälligkeit\n\n", "Zieldatum")).toEqual([
      "due",
      "deadline",
      "Fälligkeit"
    ]);
  });

  it("drops repeats, the property itself and unusable names", () => {
    expect(
      normalizeDueSynonyms(["due", "due", "Zieldatum", "", 3, null, "x".repeat(65)], "Zieldatum")
    ).toEqual(["due"]);
  });

  it("is empty for anything that is no list", () => {
    for (const value of [undefined, null, 3, { due: true }]) {
      expect(normalizeDueSynonyms(value, "Zieldatum")).toEqual([]);
    }
  });

  it(`stops at ${MAX_DUE_SYNONYMS}`, () => {
    const many = Array.from({ length: 50 }, (_, i) => `key${i}`);
    expect(normalizeDueSynonyms(many, "Zieldatum")).toEqual(many.slice(0, MAX_DUE_SYNONYMS));
  });
});

describe("moving off schreibstubeDue", () => {
  const plan = (frontmatter: unknown, property = "Zieldatum") =>
    planDueMove(frontmatter, property, berlinSummer);

  it("has nothing to do while the property is schreibstubeDue or the note lacks it", () => {
    expect(plan({ schreibstubeDue: "2026-10-12" }, "schreibstubeDue")).toBe("none");
    expect(plan({ Zieldatum: "2026-10-12" })).toBe("none");
    for (const frontmatter of [undefined, null, "text", {}]) expect(plan(frontmatter)).toBe("none");
  });

  it("moves a day into an empty property", () => {
    expect(plan({ schreibstubeDue: "2026-10-12" })).toBe("move");
    expect(plan({ schreibstubeDue: "2026-10-12", Zieldatum: null })).toBe("move");
    expect(plan({ schreibstubeDue: "2026-10-12", Zieldatum: " " })).toBe("move");
  });

  it("drops an empty old key, or one that repeats the property's day", () => {
    expect(plan({ schreibstubeDue: null, Zieldatum: "2026-10-01" })).toBe("drop");
    expect(plan({ schreibstubeDue: "" })).toBe("drop");
    expect(plan({ schreibstubeDue: "2026-10-12", Zieldatum: "2026-10-12T09:00" })).toBe("drop");
  });

  it("leaves two different values for the person", () => {
    expect(plan({ schreibstubeDue: "2026-10-12", Zieldatum: "2026-10-13" })).toBe("conflict");
    expect(plan({ schreibstubeDue: "2026-10-12", Zieldatum: "soon" })).toBe("conflict");
    expect(plan({ schreibstubeDue: "soon", Zieldatum: "later" })).toBe("conflict");
  });

  it("writes what it planned, and nothing for a conflict", () => {
    const moved: Record<string, unknown> = { schreibstubeDue: "2026-10-12", title: "A" };
    expect(moveDue(moved, "Zieldatum", berlinSummer)).toBe("move");
    expect(moved).toEqual({ Zieldatum: "2026-10-12", title: "A" });

    const dropped: Record<string, unknown> = {
      schreibstubeDue: "2026-10-12",
      Zieldatum: "2026-10-12"
    };
    expect(moveDue(dropped, "Zieldatum", berlinSummer)).toBe("drop");
    expect(dropped).toEqual({ Zieldatum: "2026-10-12" });

    const kept: Record<string, unknown> = {
      schreibstubeDue: "2026-10-12",
      Zieldatum: "2026-10-13"
    };
    expect(moveDue(kept, "Zieldatum", berlinSummer)).toBe("conflict");
    expect(kept).toEqual({ schreibstubeDue: "2026-10-12", Zieldatum: "2026-10-13" });
  });

  it("counts the notes and names the first conflicts", () => {
    const entries = [
      { path: "a.md", move: "move" as const },
      { path: "b.md", move: "none" as const },
      { path: "c.md", move: "drop" as const },
      ...Array.from({ length: 7 }, (_, i) => ({ path: `x${i}.md`, move: "conflict" as const }))
    ];
    const tally = tallyDueMoves(entries);
    expect(tally).toMatchObject({ move: 1, drop: 1, conflict: 7 });
    expect(tally.conflicts).toEqual(
      Array.from({ length: MAX_DUE_CONFLICTS_NAMED }, (_, i) => `x${i}.md`)
    );
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

describe("dueLabel", () => {
  const day = due("2026-10-12") as DueDate;

  it("leaves the year out when it is this one", () => {
    expect(dueLabel(day, "2026-01-01", "en").text).toBe("Oct 12");
    expect(dueLabel(day, "2026-01-01", "de").text).toBe("12. Okt.");
  });

  it("names the year when it is not this one, ahead or behind", () => {
    expect(dueLabel(day, "2025-12-31", "en").text).toBe("Oct 12, 2026");
    expect(dueLabel(day, "2027-01-01", "de").text).toBe("12. Okt. 2026");
  });

  it("carries the state and the whole day for the label", () => {
    expect(dueLabel(day, "2026-10-13", "en")).toEqual({
      text: "Oct 12",
      state: "overdue",
      long: "October 12, 2026"
    });
    expect(dueLabel(day, "2026-10-12", "de")).toEqual({
      text: "12. Okt.",
      state: "today",
      long: "12. Oktober 2026"
    });
  });

  it("gives the same answer when asked again", () => {
    const first = dueLabel(day, "2026-01-01", "en");
    expect(dueLabel(day, "2026-01-01", "en")).toEqual(first);
    expect(dueLabel(day, "2026-01-01", "de").text).not.toBe(first.text);
  });
});

describe("dueDrawKey", () => {
  it("changes when the day turns, but only while dates are shown", () => {
    expect(dueDrawKey(true, "2026-10-12")).not.toBe(dueDrawKey(true, "2026-10-13"));
    expect(dueDrawKey(false, "2026-10-12")).toBe(dueDrawKey(false, "2026-10-13"));
  });

  it("changes when the dates are switched on or off", () => {
    expect(dueDrawKey(true, "2026-10-12")).not.toBe(dueDrawKey(false, "2026-10-12"));
  });
});
