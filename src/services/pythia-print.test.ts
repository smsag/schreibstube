import { describe, expect, it } from "vitest";
import {
  checkExportCopy,
  checkInspection,
  checkRefresh,
  MAX_PYTHIA_COPY_GROWTH,
  MAX_PYTHIA_COUNT,
  offersPythia,
  printedSource
} from "./pythia-print";

describe("checkInspection", () => {
  it("accepts three counts", () => {
    expect(checkInspection({ links: 3, outdated: 1, missing: 0 })).toEqual({
      links: 3,
      outdated: 1,
      missing: 0
    });
  });

  it("reads anything else as no answer", () => {
    expect(checkInspection(null)).toBeNull();
    expect(checkInspection("3")).toBeNull();
    expect(checkInspection({ links: -1, outdated: 0, missing: 0 })).toBeNull();
    expect(checkInspection({ links: 1.5, outdated: 0, missing: 0 })).toBeNull();
    expect(checkInspection({ links: "1", outdated: 0, missing: 0 })).toBeNull();
    expect(checkInspection({ links: 1, outdated: 0 })).toBeNull();
    expect(checkInspection({ links: MAX_PYTHIA_COUNT + 1, outdated: 0, missing: 0 })).toBeNull();
  });
});

describe("offersPythia", () => {
  it("offers the footnotes only for a note with a link", () => {
    expect(offersPythia({ links: 1, outdated: 0, missing: 0 })).toBe(true);
    expect(offersPythia({ links: 0, outdated: 0, missing: 0 })).toBe(false);
    expect(offersPythia(null)).toBe(false);
  });
});

describe("checkRefresh", () => {
  it("counts what was written and what was not", () => {
    expect(checkRefresh({ refreshed: 2, failed: [{ id: "c", reason: "empty" }] })).toEqual({
      refreshed: 2,
      failed: 1
    });
  });

  it("reads anything else as no answer", () => {
    expect(checkRefresh(undefined)).toBeNull();
    expect(checkRefresh({ refreshed: 2 })).toBeNull();
    expect(checkRefresh({ refreshed: -2, failed: [] })).toBeNull();
  });
});

describe("the printed text", () => {
  const note = "The index is ==[capped](obsidian://pythia?cmd=resume&id=c&msg=m)== for now.";
  const copy = "The index is ==capped==[^1] for now.\n\n[^1]: “Rent cap” (Pythia) — Capped.\n";

  it("is the note as it is when the footnotes are off, and Pythia is not asked", () => {
    let asked = false;
    const result = printedSource(note, false, () => {
      asked = true;
      return copy;
    });
    expect(result).toEqual({ text: note, unavailable: false });
    expect(asked).toBe(false);
  });

  it("is Pythia's copy when the footnotes are on", () => {
    expect(printedSource(note, true, () => copy)).toEqual({ text: copy, unavailable: false });
  });

  it("falls back to the note, and says so, when Pythia does not hand over a usable copy", () => {
    expect(printedSource(note, true, () => undefined)).toEqual({ text: note, unavailable: true });
    expect(printedSource(note, true, () => 42)).toEqual({ text: note, unavailable: true });
    expect(
      printedSource(note, true, () => {
        throw new Error("gone");
      })
    ).toEqual({ text: note, unavailable: true });
  });

  it("refuses a copy grown past what footnotes could add", () => {
    expect(checkExportCopy(note + "x".repeat(MAX_PYTHIA_COPY_GROWTH), note)).toBe(
      note + "x".repeat(MAX_PYTHIA_COPY_GROWTH)
    );
    expect(checkExportCopy(note + "x".repeat(MAX_PYTHIA_COPY_GROWTH + 1), note)).toBeNull();
  });
});
