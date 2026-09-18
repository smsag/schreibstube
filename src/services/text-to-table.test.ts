import { describe, expect, it } from "vitest";
import { padForInsertion, renderMarkdownTable, tableLabelsFor, textToTable } from "./text-to-table";

const COLOR_LIST = [
  "Privates: RGB(84,190,247) #54BEF7",
  "Lentje: RGB(252,238,79) #FCEE4F",
  "Familiäre: ",
  "Weiterbildendes: RGB(134,223,106) #86DF6A oder #00FF00"
].join("\n");

describe("textToTable", () => {
  it("splits a colour list into RGB and Hex columns", () => {
    expect(textToTable(COLOR_LIST, { name: "Name", value: "Wert" })).toEqual({
      header: ["Name", "RGB", "Hex"],
      rows: [
        ["Privates", "RGB(84, 190, 247)", "`#54BEF7`"],
        ["Lentje", "RGB(252, 238, 79)", "`#FCEE4F`"],
        ["Familiäre", "–", "–"],
        ["Weiterbildendes", "RGB(134, 223, 106)", "`#86DF6A`, `#00FF00`"]
      ]
    });
  });

  it("keeps a plain key/value list in two columns with the given labels", () => {
    expect(textToTable("Autor: Kafka\nJahr: 1925", { name: "Name", value: "Wert" })).toEqual({
      header: ["Name", "Wert"],
      rows: [["Autor", "Kafka"], ["Jahr", "1925"]]
    });
  });

  it("does not split colours when a value carries other text", () => {
    const table = textToTable("Rot: #FF0000 für Fehler\nGrün: #00FF00");
    expect(table?.header).toEqual(["Name", "Value"]);
    expect(table?.rows[0]).toEqual(["Rot", "#FF0000 für Fehler"]);
  });

  it("strips list markers", () => {
    expect(textToTable("- a: 1\n- b: 2")?.rows).toEqual([["a", "1"], ["b", "2"]]);
  });

  it("uses the first line of tab-separated text as header", () => {
    expect(textToTable("Name\tAlter\nAnna\t31\nBen\t27")).toEqual({
      header: ["Name", "Alter"],
      rows: [["Anna", "31"], ["Ben", "27"]]
    });
  });

  it("parses semicolon-separated text", () => {
    expect(textToTable("a;b\n1;2")?.rows).toEqual([["1", "2"]]);
  });

  it("parses comma-separated text with quoted cells", () => {
    expect(textToTable('Stadt,Motto\nBerlin,"arm, aber sexy"')).toEqual({
      header: ["Stadt", "Motto"],
      rows: [["Berlin", "arm, aber sexy"]]
    });
  });

  it("does not split on commas inside parentheses", () => {
    expect(textToTable("Farbe,Wert\nblau,RGB(0,0,255)")?.rows).toEqual([["blau", "RGB(0,0,255)"]]);
  });

  it("returns null for prose", () => {
    const prose = "Am Morgen regnete es.\nDanach schien die Sonne und wir gingen spazieren.";
    expect(textToTable(prose)).toBeNull();
  });

  it("returns null when only some lines are key/value", () => {
    expect(textToTable("Titel: Der Process\nEin Roman über Josef K.")).toBeNull();
  });

  it("does not mistake URLs for key/value lines", () => {
    expect(textToTable("https://example.com\nhttps://obsidian.md")).toBeNull();
  });

  it("returns null for a single line", () => {
    expect(textToTable("a: 1")).toBeNull();
  });
});

describe("renderMarkdownTable", () => {
  it("renders header, separator and rows", () => {
    expect(renderMarkdownTable({ header: ["a", "b"], rows: [["1", "2"]] })).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |"
    );
  });

  it("escapes pipes inside cells", () => {
    expect(renderMarkdownTable({ header: ["a"], rows: [["x|y"]] })).toContain("x\\|y");
  });
});

describe("padForInsertion", () => {
  it("adds blank lines next to text", () => {
    expect(padForInsertion("T", "Absatz", "Weiter")).toBe("\nT\n");
  });

  it("adds nothing next to blank lines or document edges", () => {
    expect(padForInsertion("T", "", null)).toBe("T");
    expect(padForInsertion("T", null, "  ")).toBe("T");
  });
});

describe("tableLabelsFor", () => {
  it("uses German labels for a German interface", () => {
    expect(tableLabelsFor("de").value).toBe("Wert");
  });

  it("falls back to English for other languages", () => {
    expect(tableLabelsFor("en-GB").value).toBe("Value");
    expect(tableLabelsFor("fr").value).toBe("Value");
  });
});
