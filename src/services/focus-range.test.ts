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
    const doc = createDoc([
      "# Heading",
      "",
      "First line",
      "Second line",
      "",
      "Tail"
    ]);

    expect(resolveFocusRange(doc, 2, "paragraph")).toEqual({
      startLine: 3,
      endLine: 4
    });
  });

  it("treats headings as standalone blocks", () => {
    const doc = createDoc([
      "# Heading",
      "Paragraph"
    ]);

    expect(resolveFocusRange(doc, 0, "paragraph")).toEqual({
      startLine: 1,
      endLine: 1
    });
  });

  it("treats each list item as a standalone block", () => {
    const doc = createDoc([
      "- [ ] First todo",
      "- [ ] Second todo",
      "- [ ] Third todo"
    ]);

    expect(resolveFocusRange(doc, 1, "paragraph")).toEqual({
      startLine: 2,
      endLine: 2
    });
  });

  it("returns full fenced code block when cursor is inside", () => {
    const doc = createDoc([
      "```ts",
      "const a = 1;",
      "const b = 2;",
      "```",
      "",
      "tail"
    ]);

    expect(resolveFocusRange(doc, 1, "paragraph")).toEqual({
      startLine: 1,
      endLine: 4
    });
  });
});
