import { describe, expect, it } from "vitest";
import { transform } from "esbuild";
import { createMapper, decodeVlq, rewriteTrace } from "./source-map.mjs";

/**
 * The map under test is produced by the same esbuild that builds the release,
 * from a source small enough to know where everything is.
 */
const SOURCE = [
  "export class Panel {",
  "  open(): void {",
  "    throw new Error('opened');",
  "  }",
  "}",
  "export function greet(name: string): string {",
  "  return `Hallo ${name}`;",
  "}"
].join("\n");

async function build() {
  const result = await transform(SOURCE, {
    loader: "ts",
    minify: true,
    sourcemap: true,
    sourcefile: "src/ui/panel.ts"
  });
  return { code: result.code, map: JSON.parse(result.map) };
}

/** 1-based line and column of a needle in the generated code. */
function positionOf(code, needle) {
  const index = code.indexOf(needle);
  if (index < 0) throw new Error(`${needle} not in output`);
  const before = code.slice(0, index);
  const line = before.split("\n").length;
  const column = index - before.lastIndexOf("\n");
  return { line, column };
}

describe("decodeVlq", () => {
  it("reads the worked examples from the specification", () => {
    expect(decodeVlq("A")).toEqual([0]);
    expect(decodeVlq("C")).toEqual([1]);
    expect(decodeVlq("D")).toEqual([-1]);
    expect(decodeVlq("gB")).toEqual([16]);
    expect(decodeVlq("AAgBC")).toEqual([0, 0, 16, 1]);
  });

  it("refuses a character outside the alphabet", () => {
    expect(() => decodeVlq("A!")).toThrow(/base64/);
  });
});

describe("createMapper", () => {
  it("maps a minified position back to the TypeScript line that produced it", async () => {
    const { code, map } = await build();
    const at = positionOf(code, "opened");
    const original = createMapper(map).lookup(at.line, at.column);
    expect(original).toMatchObject({ source: "src/ui/panel.ts", line: 3 });
  });

  it("maps the second function to its own line, not the first's", async () => {
    const { code, map } = await build();
    const at = positionOf(code, "Hallo");
    expect(createMapper(map).lookup(at.line, at.column)).toMatchObject({ line: 7 });
  });

  it("answers null for a line the map never saw", async () => {
    const { map } = await build();
    expect(createMapper(map).lookup(999, 1)).toBeNull();
  });

  it("refuses anything but a version 3 map", () => {
    expect(() => createMapper({ version: 2 })).toThrow(/version 3/);
    expect(() => createMapper(null)).toThrow(/version 3/);
  });
});

describe("rewriteTrace", () => {
  it("rewrites every position Obsidian prints, and leaves the rest of the line alone", async () => {
    const { code, map } = await build();
    const at = positionOf(code, "opened");
    const trace =
      `Error: opened\n` +
      `    at t.open (plugin:schreibstube:${at.line}:${at.column})\n` +
      `    at /vault/.obsidian/plugins/schreibstube/main.js:${at.line}:${at.column}\n` +
      `    at app.js:1:1\n`;

    const rewritten = rewriteTrace(trace, createMapper(map));

    expect(rewritten).toContain("at t.open (src/ui/panel.ts:3:");
    expect(rewritten.match(/src\/ui\/panel\.ts:3:/g)).toHaveLength(2);
    expect(rewritten).toContain("at app.js:1:1");
    expect(rewritten.startsWith("Error: opened\n")).toBe(true);
  });

  it("says so when a position is outside the map rather than dropping it", async () => {
    const { map } = await build();
    const rewritten = rewriteTrace("at plugin:schreibstube:999:1", createMapper(map));
    expect(rewritten).toBe("at plugin:schreibstube:999:1 (not in map)");
  });
});
