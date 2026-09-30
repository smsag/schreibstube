import { describe, expect, it } from "vitest";
import {
  MAX_CSV_COLUMNS,
  MAX_CSV_ROWS,
  MAX_PAD_WIDTH,
  csvToMarkdown,
  isCsvExtension,
  isNumeric,
  looksLikeData,
  parseCsv,
  renderAlignedTable
} from "./csv-table";

function markdown(text: string): string {
  const outcome = csvToMarkdown(text);
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
  return outcome.markdown;
}

describe("isCsvExtension", () => {
  it("knows comma and tab files in any case, and nothing else", () => {
    expect(["csv", "CSV", "tsv"].map(isCsvExtension)).toEqual([true, true, true]);
    expect(["md", "xlsx", "txt"].map(isCsvExtension)).toEqual([false, false, false]);
  });
});

describe("parseCsv", () => {
  it("keeps delimiters, doubled quotes and line breaks inside quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"', ",")).toEqual([
      ["a", "b, c", 'say "hi"', "two\nlines"]
    ]);
  });

  it("splits records on every kind of line ending", () => {
    expect(parseCsv("a\r\nb\rc\nd", ",")).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("reads a quote in the middle of a cell as a quote", () => {
    expect(parseCsv('5" nail,3', ",")).toEqual([['5" nail', "3"]]);
  });

  it("opens a quoted field after the spaces people type", () => {
    expect(parseCsv('a, "b,c"', ",")).toEqual([["a", " b,c"]]);
  });

  it("drops blank lines and stops after the limit", () => {
    expect(parseCsv("a\n\n ,\nb\nc\nd", ",", 2)).toEqual([["a"], ["b"]]);
  });

  it("refuses a quote that never closes", () => {
    expect(parseCsv('a,"b\nc,d', ",")).toBeNull();
  });
});

describe("csvToMarkdown", () => {
  it("turns a comma file into an aligned table", () => {
    expect(markdown("Name,Ort\nAnna,Berlin\nBo,Köln\n")).toBe(
      ["| Name | Ort    |", "| ---- | ------ |", "| Anna | Berlin |", "| Bo   | Köln   |"].join(
        "\n"
      )
    );
  });

  it("finds the semicolon of a German Excel file and its decimal commas", () => {
    expect(markdown("Posten;Betrag\nMiete;1.234,50\nStrom;85,20")).toBe(
      [
        "| Posten |   Betrag |",
        "| ------ | -------: |",
        "| Miete  | 1.234,50 |",
        "| Strom  |    85,20 |"
      ].join("\n")
    );
  });

  it("reads a tab-separated file", () => {
    expect(markdown("a\tb\n1\t2")).toBe("|   a |   b |\n| --: | --: |\n|   1 |   2 |");
  });

  it("drops the byte-order mark Excel writes and the blank lines", () => {
    expect(markdown("\uFEFFName,Ort\n\nAnna,Berlin\n\n")).toMatch(/^\| Name \| Ort {4}\|/);
  });

  it("fills short rows with empty cells", () => {
    expect(markdown("a,b,c\n1\nx,y,z,w")).toBe(
      [
        "| a   | b   | c   |     |",
        "| --- | --- | --- | --- |",
        "| 1   |     |     |     |",
        "| x   | y   | z   | w   |"
      ].join("\n")
    );
  });

  it("escapes pipes and turns line breaks into <br>", () => {
    expect(markdown('Name,Note\nAnna,"a|b\nc"')).toContain("| Anna | a\\|b<br>c |");
  });

  it("invents a header when the first row is data", () => {
    const outcome = csvToMarkdown("Anna;12\nBo;7", (i) => `Spalte ${i}`);
    expect(outcome).toMatchObject({ ok: true, rows: 2, columns: 2 });
    expect(outcome.ok && outcome.markdown.split("\n")[0]).toBe("| Spalte 1 | Spalte 2 |");
  });

  it("keeps a one-column file as a one-column table", () => {
    expect(markdown("Name\nAnna\nBo")).toBe("| Name |\n| ---- |\n| Anna |\n| Bo   |");
  });

  it("stops padding at a paragraph-long cell", () => {
    const long = "x".repeat(MAX_PAD_WIDTH + 20);
    const lines = markdown(`a,b\n${long},1\ny,2`).split("\n");
    expect(lines[3]).toBe(`| y${" ".repeat(MAX_PAD_WIDTH - 1)} |   2 |`);
    expect(lines[2]).toBe(`| ${long} |   1 |`);
  });

  it("refuses an empty file, an open quote, too many rows or columns", () => {
    expect(csvToMarkdown(" \n\uFEFF")).toEqual({ ok: false, reason: "empty" });
    expect(csvToMarkdown("\uFEFF")).toEqual({ ok: false, reason: "empty" });
    expect(csvToMarkdown('"a,b;c\td')).toEqual({ ok: false, reason: "malformed" });
    const rows = ["h1,h2", ...Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `r${i},x`)];
    expect(csvToMarkdown(rows.join("\n"))).toEqual({ ok: false, reason: "too-many-rows" });
    const wide = Array.from({ length: MAX_CSV_COLUMNS + 1 }, (_, i) => `c${i}`).join(",");
    expect(csvToMarkdown(wide)).toEqual({ ok: false, reason: "too-many-columns" });
  });

  it("says a quote is open rather than guess another delimiter", () => {
    // Under a tab or a comma the quote stands mid-field and reads as text.
    expect(csvToMarkdown('Name;Note\nAnna;"unfinished\nBo;ok')).toEqual({
      ok: false,
      reason: "malformed"
    });
  });

  it("calls a file of nothing but delimiters empty", () => {
    expect(csvToMarkdown(";;;\n;;;\n")).toEqual({ ok: false, reason: "empty" });
  });

  it("leaves out the title line above an export's header", () => {
    expect(markdown("Kontoauszug März 2026\nDatum;Betrag\n01.03.;-12,50\n02.03.;800")).toBe(
      [
        "| Datum  | Betrag |",
        "| ------ | -----: |",
        "| 01.03. | -12,50 |",
        "| 02.03. |    800 |"
      ].join("\n")
    );
  });

  it("picks the delimiter most rows agree on, not the first row's", () => {
    expect(markdown("a;b\n1;2;3\n4;5;6\n7;8;9")).toContain("|   a |   b |     |");
  });

  it("refuses too many rows without reading past them", () => {
    const rows = Array.from({ length: MAX_CSV_ROWS + 2 }, (_, i) => `r${i};x`);
    expect(csvToMarkdown(["h1;h2", ...rows, '"open'].join("\n"))).toEqual({
      ok: false,
      reason: "too-many-rows"
    });
  });

  it("counts a decomposed umlaut and a flag as one character", () => {
    expect(markdown("Ort,Land\nKo\u0308ln,🇩🇪\nBonn,DE")).toBe(
      ["| Ort  | Land |", "| ---- | ---- |", "| Köln | 🇩🇪    |", "| Bonn | DE   |"].join("\n")
    );
  });

  it("keeps a backslash before a pipe inside its cell", () => {
    expect(markdown("a,b\nC:\\temp\\|x,1")).toContain("| C:\\temp\\\\\\|x |");
  });

  it("takes exactly the row limit", () => {
    const rows = ["h1,h2", ...Array.from({ length: MAX_CSV_ROWS }, (_, i) => `r${i},x`)];
    expect(csvToMarkdown(rows.join("\n"))).toMatchObject({ ok: true, rows: MAX_CSV_ROWS });
  });
});

describe("looksLikeData", () => {
  it("reads text over numbers as a header", () => {
    expect(looksLikeData(["Name", "Betrag"], [["Anna", "12"]])).toBe(false);
  });

  it("reads numbers over numbers as data", () => {
    expect(looksLikeData(["Anna", "12"], [["Bo", "7"]])).toBe(true);
  });

  it("keeps a header when nothing argues either way", () => {
    expect(looksLikeData(["Name", "Ort"], [["Anna", "Berlin"]])).toBe(false);
  });

  it("reads years over amounts as a header", () => {
    expect(looksLikeData(["Name", "2023", "2024"], [["Miete", "1.200", "1.250"]])).toBe(false);
  });

  it("reads a lone amount in the range of years as data", () => {
    expect(looksLikeData(["Miete", "1950"], [["Strom", "85"]])).toBe(true);
  });

  it("reads years that do not follow one another as data", () => {
    expect(looksLikeData(["Miete", "1950", "2000"], [["Strom", "85", "90"]])).toBe(true);
  });

  it("reads years over years as data", () => {
    expect(looksLikeData(["Anna", "1990"], [["Bo", "1985"]])).toBe(true);
  });

  it("reads a lone row with a number as data, and a lone row of text as a header", () => {
    expect(looksLikeData(["Anna", "12"], [])).toBe(true);
    expect(looksLikeData(["Name", "Ort"], [])).toBe(false);
  });

  it("ignores columns that are empty below", () => {
    expect(looksLikeData(["Anna", "12"], [["Bo", ""]])).toBe(false);
  });
});

describe("isNumeric", () => {
  it.each(["12", "-3", "3,5", "3.5", "1.234,50", "1,234.50", "1 234", "12 %", "€ 5", "5 EUR"])(
    "reads %s as a number",
    (cell) => expect(isNumeric(cell)).toBe(true)
  );

  it.each(["", "abc", "1.2.3,4.5", "12a", "1,2,3", "2024-01-05", "1.234.5"])(
    "does not read %s as a number",
    (cell) => expect(isNumeric(cell)).toBe(false)
  );
});

describe("renderAlignedTable", () => {
  it("leaves a header-only table with a rule and nothing below", () => {
    expect(renderAlignedTable({ header: ["a"], rows: [] })).toBe("| a   |\n| --- |");
  });
});
