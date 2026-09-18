import { describe, expect, it } from "vitest";
import { resolveFocusRange, type LineDoc } from "./focus-range";

function createDoc(lines: string[]): LineDoc {
  return {
    lines: lines.length,
    line: (lineNumber: number) => ({ text: lines[lineNumber - 1] ?? "" })
  };
}

describe("resolveFocusRange", () => {
  it("returns null when focus mode is off", () => {
    const doc = createDoc(["A", "B"]);
    expect(resolveFocusRange(doc, 0, "off")).toBe(null);
  });

  it("returns cursor line for sentence mode", () => {
    const doc = createDoc(["A", "B", "C"]);
    expect(resolveFocusRange(doc, 1, "sentence")).toEqual({ startLine: 2, endLine: 2 });
  });

  it("returns sentence span for sentence mode when cursor column is provided", () => {
    const doc = createDoc(["First sentence. Second sentence. Third sentence."]);
    expect(resolveFocusRange(doc, 0, "sentence", 8)).toEqual({
      startLine: 1,
      endLine: 1,
      startCh: 0,
      endCh: 15
    });
  });

  it("returns a later sentence span when cursor column moves later in the line", () => {
    const doc = createDoc(["First sentence. Second sentence. Third sentence."]);
    expect(resolveFocusRange(doc, 0, "sentence", 18)).toEqual({
      startLine: 1,
      endLine: 1,
      startCh: 16,
      endCh: 32
    });
  });

  it("falls back to the whole line when cursor column is omitted", () => {
    const doc = createDoc(["First sentence. Second sentence."]);
    expect(resolveFocusRange(doc, 0, "sentence")).toEqual({
      startLine: 1,
      endLine: 1
    });
  });

  it("returns contiguous paragraph block", () => {
    const doc = createDoc(["# Heading", "", "First line", "Second line", "", "Tail"]);

    expect(resolveFocusRange(doc, 2, "paragraph")).toEqual({
      startLine: 3,
      endLine: 4
    });
  });

  it("treats headings as standalone blocks", () => {
    const doc = createDoc(["# Heading", "Paragraph"]);

    expect(resolveFocusRange(doc, 0, "paragraph")).toEqual({
      startLine: 1,
      endLine: 1
    });
  });

  it("treats each list item as a standalone block", () => {
    const doc = createDoc(["- [ ] First todo", "- [ ] Second todo", "- [ ] Third todo"]);

    expect(resolveFocusRange(doc, 1, "paragraph")).toEqual({
      startLine: 2,
      endLine: 2
    });
  });

  it("returns full fenced code block when cursor is inside", () => {
    const doc = createDoc(["```ts", "const a = 1;", "const b = 2;", "```", "", "tail"]);

    expect(resolveFocusRange(doc, 1, "paragraph")).toEqual({
      startLine: 1,
      endLine: 4
    });
  });
});

describe("sentence focus where the caret actually sits", () => {
  const text = "Der erste Satz. Der zweite Satz endet hier";
  const doc = createDoc([text]);

  it("holds the last sentence when the caret is at the end of the line", () => {
    // Which is where it is while the line is being written. It matched no span
    // at all before, and the whole line lit up instead of the sentence.
    expect(resolveFocusRange(doc, 0, "sentence", text.length)).toEqual({
      startLine: 1,
      endLine: 1,
      startCh: 16,
      endCh: text.length
    });
  });

  it("holds the sentence just finished when the caret is on its full stop", () => {
    expect(resolveFocusRange(doc, 0, "sentence", 15)).toEqual({
      startLine: 1,
      endLine: 1,
      startCh: 0,
      endCh: 15
    });
  });

  it("gives the gap between two sentences to the one about to be written", () => {
    expect(resolveFocusRange(doc, 0, "sentence", 16)?.startCh).toBe(16);
  });
});

describe("sentence focus and a full stop that ends no sentence", () => {
  function span(line: string, column: number): string {
    const range = resolveFocusRange(createDoc([line]), 0, "sentence", column);
    return line.slice(range?.startCh ?? 0, range?.endCh ?? line.length);
  }

  it("reads through an abbreviation written with spaces", () => {
    const line = "Das gilt z. B. für Objekte in der Innenstadt.";
    expect(span(line, 25)).toBe(line);
  });

  it("reads through a spelled-out abbreviation", () => {
    const line = "Die Fläche beträgt ca. 120 Quadratmeter und mehr.";
    expect(span(line, 30)).toBe(line);
  });

  it("reads through an ordinal date", () => {
    const line = "Der Termin ist am 1. Oktober bei uns im Büro.";
    expect(span(line, 30)).toBe(line);
  });

  it("still ends a sentence at a real full stop", () => {
    const line = "Erster Satz. Zweiter Satz.";
    expect(span(line, 20)).toBe("Zweiter Satz.");
  });
});
