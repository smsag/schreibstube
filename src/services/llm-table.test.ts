import { describe, expect, it } from "vitest";
import { findExecutableCode } from "./executable-code";
import { guardTableCode, parseTableResponse } from "./llm-table";
import { renderMarkdownTable, type MarkdownTable } from "./text-to-table";

describe("parseTableResponse", () => {
  it("reads a plain JSON reply", () => {
    expect(parseTableResponse('{"header":["a","b"],"rows":[["1","2"]]}')).toEqual({
      header: ["a", "b"],
      rows: [["1", "2"]]
    });
  });

  it("reads JSON wrapped in a code fence and prose", () => {
    const raw = 'Here is the table:\n```json\n{"header":["a","b"],"rows":[["1","2"]]}\n```';
    expect(parseTableResponse(raw)?.rows).toEqual([["1", "2"]]);
  });

  it("writes a cell that is not text as what it holds, never as [object Object]", () => {
    const raw = '{"header":["a","b"],"rows":[[1,true],[{"x":1},["p","q"]],[null,"t"]]}';
    expect(parseTableResponse(raw)?.rows).toEqual([
      ["1", "true"],
      ['{"x":1}', '["p","q"]'],
      ["–", "t"]
    ]);
  });

  it("pads short rows and trims long ones to the header width", () => {
    const raw = '{"header":["a","b"],"rows":[["1"],["1","2","3"]]}';
    expect(parseTableResponse(raw)?.rows).toEqual([
      ["1", "–"],
      ["1", "2"]
    ]);
  });

  it("turns empty and null cells into a placeholder", () => {
    const raw = '{"header":["a","b"],"rows":[["", null]]}';
    expect(parseTableResponse(raw)?.rows).toEqual([["–", "–"]]);
  });

  it("stringifies numbers and flattens line breaks", () => {
    const raw = '{"header":["a","b"],"rows":[[42,"x\\ny"]]}';
    expect(parseTableResponse(raw)?.rows).toEqual([["42", "x y"]]);
  });

  it("rejects a reply without JSON", () => {
    expect(parseTableResponse("I cannot turn this into a table.")).toBeNull();
  });

  it("rejects truncated JSON", () => {
    expect(parseTableResponse('{"header":["a","b"],"rows":[["1","2"]')).toBeNull();
  });

  it("rejects a single-column table", () => {
    expect(parseTableResponse('{"header":["a"],"rows":[["1"]]}')).toBeNull();
  });

  it("rejects a table without rows", () => {
    expect(parseTableResponse('{"header":["a","b"],"rows":[]}')).toBeNull();
  });
});

describe("guardTableCode", () => {
  const table = (rows: string[][]): MarkdownTable => ({ header: ["A", "B"], rows });

  it("leaves a table without code as it is", () => {
    const plain = table([["`#54BEF7`", "Blau"]]);
    expect(guardTableCode(plain, "Blau #54BEF7")).toEqual({ table: plain, kinds: [] });
  });

  it("disarms code in a cell that the selection did not hold", () => {
    const hostile = table([["`$= app.vault.getFiles()`", "<% tp.file.title %>"]]);
    const guarded = guardTableCode(hostile, "a; b");
    expect(guarded.kinds).toEqual(["dataviewjs", "templater"]);
    expect(findExecutableCode(renderMarkdownTable(guarded.table))).toEqual([]);
  });

  it("keeps the selection's own code, word for word", () => {
    const own = "`$= dv.pages().length`";
    expect(guardTableCode(table([[own, "x"]]), `Anzahl: ${own}`).kinds).toEqual([]);
  });

  it("disarms a Templater tag opened in one cell and closed in the next", () => {
    const guarded = guardTableCode(table([["<% tp.file.move('/x')", "%>"]]), "a; b");
    expect(guarded.kinds).toEqual(["templater"]);
    expect(findExecutableCode(renderMarkdownTable(guarded.table))).toEqual([]);
  });
});
