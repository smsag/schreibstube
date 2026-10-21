import { describe, expect, it } from "vitest";
import { mentionsCsvTable, normalizeSourcePath, retargetCsvTableSources } from "./csvtable-source";

const moves = (pairs: Record<string, string>) => (path: string) => pairs[path] ?? null;

function retarget(markdown: string, pairs: Record<string, string>) {
  return retargetCsvTableSources(markdown, moves(pairs));
}

const block = (...lines: string[]) => ["```csvtable", ...lines, "```"].join("\n");

describe("mentionsCsvTable", () => {
  it("looks for the block's name in any case", () => {
    expect(mentionsCsvTable("```CSVTable\nsource: a.csv\n```")).toBe(true);
    expect(mentionsCsvTable("| a | b |")).toBe(false);
  });
});

describe("normalizeSourcePath", () => {
  it("resolves as the other plugin does: from the root, slashes folded, ./ dropped", () => {
    expect(normalizeSourcePath("./Daten/miete.csv")).toBe("Daten/miete.csv");
    expect(normalizeSourcePath("/Daten//miete.csv")).toBe("Daten/miete.csv");
    expect(normalizeSourcePath("Daten\\miete.csv")).toBe("Daten/miete.csv");
    expect(normalizeSourcePath("./././a.csv")).toBe("a.csv");
  });

  it("composes a decomposed umlaut, as a Mac writes one", () => {
    expect(normalizeSourcePath("Mieter/Müller.csv")).toBe("Mieter/Müller.csv");
  });
});

describe("retargetCsvTableSources", () => {
  it("moves a bare source and leaves the rest of the block alone", () => {
    const note = ["# Mieten", "", block("source: Daten/miete.csv", "maxRows: 5"), "Ende"].join(
      "\n"
    );
    const { text, changed } = retarget(note, { "Daten/miete.csv": "Archiv/miete-2026.csv" });
    expect(changed).toBe(1);
    expect(text).toBe(note.replace("Daten/miete.csv", "Archiv/miete-2026.csv"));
  });

  it("finds the source written relative to the root with ./", () => {
    const { text } = retarget(block("source: ./miete.csv"), { "miete.csv": "Daten/miete.csv" });
    expect(text).toContain("source: Daten/miete.csv");
  });

  it("keeps the quoting, and a comment after the path", () => {
    expect(retarget(block('source: "a.csv" # Export'), { "a.csv": 'b "neu".csv' }).text).toContain(
      'source: "b \\"neu\\".csv" # Export'
    );
    expect(retarget(block("source: 'a.csv'"), { "a.csv": "O'Brien.csv" }).text).toContain(
      "source: 'O''Brien.csv'"
    );
    expect(retarget(block("source:   a.csv   # alt"), { "a.csv": "b.csv" }).text).toContain(
      "source:   b.csv   # alt"
    );
  });

  it("reads quoted paths the way YAML does", () => {
    expect(retarget(block('source: "x \\"y\\".csv"'), { 'x "y".csv': "z.csv" }).changed).toBe(1);
    expect(retarget(block("source: 'it''s.csv'"), { "it's.csv": "z.csv" }).changed).toBe(1);
  });

  it("quotes a bare path that YAML would read as something else", () => {
    expect(retarget(block("source: a.csv"), { "a.csv": "Q1: Mieten.csv" }).text).toContain(
      'source: "Q1: Mieten.csv"'
    );
    expect(retarget(block("source: a.csv"), { "a.csv": "#1.csv" }).text).toContain(
      'source: "#1.csv"'
    );
  });

  it("takes a # inside a name as part of it", () => {
    expect(retarget(block("source: Q#3.csv"), { "Q#3.csv": "Q4.csv" }).text).toContain(
      "source: Q4.csv"
    );
  });

  it("touches only csvtable blocks, and only their first source", () => {
    const note = [
      "source: a.csv",
      "```yaml",
      "source: a.csv",
      "```",
      block("source: a.csv", "source: a.csv")
    ].join("\n");
    const { text, changed } = retarget(note, { "a.csv": "b.csv" });
    expect(changed).toBe(1);
    expect(text.split("\n")).toEqual([
      "source: a.csv",
      "```yaml",
      "source: a.csv",
      "```",
      "```csvtable",
      "source: b.csv",
      "source: a.csv",
      "```"
    ]);
  });

  it("does not mistake a csvtable block quoted in a longer fence for one", () => {
    const note = ["````markdown", block("source: a.csv"), "````"].join("\n");
    expect(retarget(note, { "a.csv": "b.csv" }).changed).toBe(0);
  });

  it("moves every block in a note and keeps Windows line endings", () => {
    const note = [block("source: a.csv"), block("source: c.csv")].join("\n").replace(/\n/g, "\r\n");
    const { text, changed } = retarget(note, { "a.csv": "b.csv", "c.csv": "d.csv" });
    expect(changed).toBe(2);
    expect(text).toBe(note.replace("a.csv", "b.csv").replace("c.csv", "d.csv"));
  });

  it("returns the note itself when no source moved", () => {
    const note = block("source: a.csv");
    const result = retarget(note, { "other.csv": "b.csv" });
    expect(result).toEqual({ text: note, changed: 0 });
  });

  it("leaves a source spread over lines, and an empty one, alone", () => {
    expect(retarget(block("source: >", "  a.csv"), { "a.csv": "b.csv" }).changed).toBe(0);
    expect(retarget(block("source:", "maxRows: 2"), { "": "b.csv" }).changed).toBe(0);
    expect(retarget(block('source: "unclosed'), { unclosed: "b.csv" }).changed).toBe(0);
    expect(retarget(block("source: 'unclosed"), { unclosed: "b.csv" }).changed).toBe(0);
  });

  it("leaves a fence that never closes open to the end, as Obsidian does", () => {
    expect(retarget("```csvtable\nsource: a.csv", { "a.csv": "b.csv" }).text).toBe(
      "```csvtable\nsource: b.csv"
    );
  });
});
