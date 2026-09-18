import { describe, expect, it } from "vitest";
import { parseTableResponse } from "./llm-table";

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
