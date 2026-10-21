import { describe, expect, it } from "vitest";
import type { NumberFormat } from "./amounts";
import { csvToGrid, cellNumber } from "./csv-table";
import {
  INITIAL_VIEW_STATE,
  MAX_QUERY_LENGTH,
  nextSort,
  normalizeViewState,
  shownGrid,
  shownMarkdown,
  toggleHidden,
  totalsRow,
  type CsvViewState
} from "./csv-grid-view";

const GERMAN: NumberFormat = { locale: "de", decimal: ",", spaceGroups: true };
const ENGLISH: NumberFormat = { locale: "en", decimal: ".", spaceGroups: false };

function grid(text: string) {
  const outcome = csvToGrid(text);
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
  return outcome;
}

function view(text: string, state: Partial<CsvViewState>, format = GERMAN) {
  const { table, numeric } = grid(text);
  return shownGrid(table, numeric, { ...INITIAL_VIEW_STATE, ...state }, format);
}

const OBJECTS = [
  "Objekt;Ort;Kaltmiete",
  "Haus 10;Köln;1.240,00 €",
  "Haus 2;Bonn;980,50 €",
  "Wohnung;;",
  "haus 1;Aachen;2.100,00 €"
].join("\n");

describe("cellNumber", () => {
  it("reads German and English grouping, currencies and signs", () => {
    expect(cellNumber("1.234,50 €", GERMAN)).toBe(1234.5);
    expect(cellNumber("$1,234.50", ENGLISH)).toBe(1234.5);
    expect(cellNumber("-20 €", GERMAN)).toBe(-20);
    expect(cellNumber("−3,5", GERMAN)).toBe(-3.5);
    expect(cellNumber("1 234", GERMAN)).toBe(1234);
  });

  it("lets the format settle a number its digits cannot", () => {
    expect(cellNumber("1.234", GERMAN)).toBe(1234);
    expect(cellNumber("1.234", ENGLISH)).toBe(1.234);
  });

  it("is null for text and for a date", () => {
    expect(cellNumber("Köln", GERMAN)).toBeNull();
    expect(cellNumber("26.09.2026", GERMAN)).toBeNull();
    expect(cellNumber("", GERMAN)).toBeNull();
  });
});

describe("nextSort", () => {
  it("goes up, down and back to the file's order", () => {
    const up = nextSort(null, 2);
    expect(up).toEqual({ column: 2, direction: "asc" });
    const down = nextSort(up, 2);
    expect(down).toEqual({ column: 2, direction: "desc" });
    expect(nextSort(down, 2)).toBeNull();
  });

  it("starts over going up on another column", () => {
    expect(nextSort({ column: 1, direction: "desc" }, 0)).toEqual({ column: 0, direction: "asc" });
  });
});

describe("toggleHidden", () => {
  it("hides and shows a column, in the file's order", () => {
    expect(toggleHidden([2], 0, 3)).toEqual([0, 2]);
    expect(toggleHidden([0, 2], 0, 3)).toEqual([2]);
  });

  it("keeps the last column shown", () => {
    const hidden = [0, 1];
    expect(toggleHidden(hidden, 2, 3)).toBe(hidden);
  });

  it("ignores a column the file does not have", () => {
    expect(toggleHidden([], 7, 3)).toEqual([]);
  });
});

describe("normalizeViewState", () => {
  it("keeps a state as the view writes it", () => {
    const state: CsvViewState = {
      sort: { column: 1, direction: "desc" },
      query: "köln",
      hidden: [0, 3],
      totals: true
    };
    expect(normalizeViewState(state)).toEqual(state);
  });

  it("drops what a hand-edited workspace got wrong", () => {
    expect(
      normalizeViewState({
        sort: { column: -1, direction: "asc" },
        query: 42,
        hidden: [3, "a", 1.5, 3, 0, -2],
        totals: "yes"
      })
    ).toEqual({ sort: null, query: "", hidden: [0, 3], totals: false });
    expect(normalizeViewState({ sort: { column: 1, direction: "up" } }).sort).toBeNull();
    expect(normalizeViewState(null)).toEqual(INITIAL_VIEW_STATE);
    expect(normalizeViewState("state")).toEqual(INITIAL_VIEW_STATE);
  });

  it("cuts a search to its bound", () => {
    expect(normalizeViewState({ query: "x".repeat(1000) }).query).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe("shownGrid", () => {
  it("shows the file as it is in the initial state", () => {
    const shown = view(OBJECTS, {});
    expect(shown.header).toEqual(["Objekt", "Ort", "Kaltmiete"]);
    expect(shown.rows.map((row) => row[0])).toEqual(["Haus 10", "Haus 2", "Wohnung", "haus 1"]);
    expect(shown.numeric).toEqual([false, false, true]);
    expect(shown.columns).toEqual([0, 1, 2]);
    expect([shown.matched, shown.total]).toEqual([4, 4]);
  });

  it("sorts numbers by value, empty cells last both ways", () => {
    const up = view(OBJECTS, { sort: { column: 2, direction: "asc" } });
    expect(up.rows.map((row) => row[2])).toEqual(["980,50 €", "1.240,00 €", "2.100,00 €", ""]);
    const down = view(OBJECTS, { sort: { column: 2, direction: "desc" } });
    expect(down.rows.map((row) => row[2])).toEqual(["2.100,00 €", "1.240,00 €", "980,50 €", ""]);
  });

  it("sorts text by language, ignoring case, with numbers inside it read as numbers", () => {
    const up = view(OBJECTS, { sort: { column: 0, direction: "asc" } });
    expect(up.rows.map((row) => row[0])).toEqual(["haus 1", "Haus 2", "Haus 10", "Wohnung"]);
    const places = view(OBJECTS, { sort: { column: 1, direction: "asc" } });
    expect(places.rows.map((row) => row[1])).toEqual(["Aachen", "Bonn", "Köln", ""]);
  });

  it("keeps the file's order among equal cells", () => {
    const shown = view("Name;Stadt\nA;Bonn\nB;Bonn\nC;Aachen", {
      sort: { column: 1, direction: "desc" }
    });
    expect(shown.rows.map((row) => row[0])).toEqual(["A", "B", "C"]);
  });

  it("keeps the rows holding the search in a shown column, ignoring case", () => {
    const shown = view(OBJECTS, { query: " KÖLN " });
    expect(shown.rows.map((row) => row[0])).toEqual(["Haus 10"]);
    expect([shown.matched, shown.total]).toEqual([1, 4]);
    expect(view(OBJECTS, { query: "köln", hidden: [1] }).matched).toBe(0);
  });

  it("leaves hidden columns out and says where the shown ones were", () => {
    const shown = view(OBJECTS, { hidden: [1] });
    expect(shown.header).toEqual(["Objekt", "Kaltmiete"]);
    expect(shown.numeric).toEqual([false, true]);
    expect(shown.columns).toEqual([0, 2]);
    expect(shown.rows[0]).toEqual(["Haus 10", "1.240,00 €"]);
  });

  it("passes over a state written for another file", () => {
    const shown = view(OBJECTS, { sort: { column: 9, direction: "asc" }, hidden: [7] });
    expect(shown.columns).toEqual([0, 1, 2]);
    expect(shown.rows[0]?.[0]).toBe("Haus 10");
    expect(view("a;b\n1;2", { hidden: [0, 1] }).columns).toEqual([0, 1]);
  });
});

describe("totalsRow", () => {
  it("adds up every column of numbers under a label in the first column of text", () => {
    expect(totalsRow([false, false, true], "Summe")).toEqual(["**Summe**", "", "**=sum**"]);
    expect(totalsRow([true, false, true], "Total")).toEqual(["**=sum**", "**Total**", "**=sum**"]);
  });

  it("goes without a label when every column is numbers, and is none without numbers", () => {
    expect(totalsRow([true, true], "Total")).toEqual(["**=sum**", "**=sum**"]);
    expect(totalsRow([false, false], "Total")).toBeNull();
  });
});

describe("shownMarkdown", () => {
  it("copies what is shown, numbers still flush right under a formula", () => {
    const shown = view(OBJECTS, {
      query: "haus",
      hidden: [1],
      sort: { column: 2, direction: "asc" }
    });
    expect(shownMarkdown(shown, totalsRow(shown.numeric, "Summe"))).toBe(
      [
        "| Objekt    |  Kaltmiete |",
        "| --------- | ---------: |",
        "| Haus 2    |   980,50 € |",
        "| Haus 10   | 1.240,00 € |",
        "| haus 1    | 2.100,00 € |",
        "| **Summe** |   **=sum** |"
      ].join("\n")
    );
  });

  it("is the file's own table when nothing is changed", () => {
    const shown = view(OBJECTS, {});
    expect(shownMarkdown(shown, null).split("\n")).toHaveLength(6);
  });
});
