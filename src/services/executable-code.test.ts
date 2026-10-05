import { describe, expect, it } from "vitest";
import { executableTouched, findExecutableCode } from "./executable-code";

const kinds = (text: string): string[] => findExecutableCode(text).map((region) => region.kind);

describe("findExecutableCode", () => {
  it("finds a dataviewjs fence, fence lines included", () => {
    const text = "Intro\n```dataviewjs\ndv.span(1)\n```\nOutro\n";
    const [region] = findExecutableCode(text);
    expect(region?.kind).toBe("dataviewjs");
    expect(text.slice(region?.from, region?.to)).toBe("```dataviewjs\ndv.span(1)\n```\n");
  });

  it("reads the language case-insensitively, after any indent, and ignores attributes", () => {
    expect(kinds("  ~~~DataviewJS {x}\na\n~~~\n")).toEqual(["dataviewjs"]);
  });

  it("knows the other executing fences", () => {
    for (const language of ["js-engine", "meta-bind-js-view", "button", "datacorejsx"]) {
      expect(kinds(`\`\`\`${language}\nx\n\`\`\`\n`)).toEqual([language]);
    }
  });

  it("leaves a fence that is only shown alone", () => {
    expect(kinds("```js\nalert(1)\n```\n```html\n<script></script>\n```\n")).toEqual([]);
  });

  it("runs an unclosed fence to the end of the text", () => {
    const text = "a\n```dataviewjs\nb\nc";
    const [region] = findExecutableCode(text);
    expect(region?.to).toBe(text.length);
  });

  it("does not let a shorter fence close a longer one", () => {
    const text = "````dataviewjs\n```\nstill code\n````\nprose\n";
    const [region] = findExecutableCode(text);
    expect(text.slice(region?.from, region?.to)).toBe("````dataviewjs\n```\nstill code\n````\n");
  });

  it("finds Dataview's inline JavaScript in prose", () => {
    const text = "Total: `$= dv.pages().length` notes.\n";
    const [region] = findExecutableCode(text);
    expect(region?.kind).toBe("dataviewjs");
    expect(text.slice(region?.from, region?.to)).toBe("`$= dv.pages().length`");
  });

  it("finds a Templater tag, across lines too", () => {
    expect(kinds("Date: <% tp.date.now() %>\n")).toEqual(["templater"]);
    expect(kinds("<%*\nawait tp.system.prompt()\n%>\n")).toEqual(["templater"]);
  });

  it("does not count inline constructs inside a shown fence", () => {
    expect(kinds("```md\n<% tp.date.now() %> and `$= 1`\n```\n")).toEqual([]);
  });

  it("finds nothing in plain prose", () => {
    expect(findExecutableCode("# Title\n\nA paragraph with `code` and 5 % 3.\n")).toEqual([]);
  });
});

describe("executableTouched", () => {
  const regions = [{ from: 10, to: 20, kind: "dataviewjs" }];

  it("counts a change that overlaps a region", () => {
    expect(executableTouched(regions, 5, 11)).toEqual(["dataviewjs"]);
    expect(executableTouched(regions, 19, 30)).toEqual(["dataviewjs"]);
  });

  it("ignores a change that only borders one", () => {
    expect(executableTouched(regions, 0, 10)).toEqual([]);
    expect(executableTouched(regions, 20, 25)).toEqual([]);
  });

  it("counts a deletion strictly inside a region, not one at its edge", () => {
    expect(executableTouched(regions, 15, 15)).toEqual(["dataviewjs"]);
    expect(executableTouched(regions, 10, 10)).toEqual([]);
    expect(executableTouched(regions, 20, 20)).toEqual([]);
  });

  it("names each kind once", () => {
    const two = [...regions, { from: 12, to: 14, kind: "dataviewjs" }];
    expect(executableTouched(two, 0, 30)).toEqual(["dataviewjs"]);
  });
});
