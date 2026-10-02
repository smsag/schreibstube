/**
 * Every setting with a name also says what it does.
 *
 * The tab grew rows that were only a name — a button called "Add account", a
 * frontmatter field called "Title" — which left a person guessing what pressing
 * or changing them would do. Read from the source, because a row is a chain of
 * calls and the chain is the place the description belongs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname);

/** Rows whose description is set later, from what is found at runtime. */
const DESCRIBED_LATER = new Set<string>([
  // Says whether the runtime is on this device, once that is known.
  "strings.printRuntimeHeading",
  // The index's state, written as it builds.
  "strings.status"
]);

/**
 * The source with every string, template and comment blanked to spaces of
 * the same length, so a bracket in a label or a placeholder cannot end a
 * chain early or join it to the next.
 */
function code(source: string): string {
  let out = "";
  let at = 0;
  while (at < source.length) {
    const c = source[at] ?? "";
    const next = source[at + 1];
    let end: number;
    if (c === "/" && next === "/") {
      end = source.indexOf("\n", at);
      if (end === -1) end = source.length;
    } else if (c === "/" && next === "*") {
      end = source.indexOf("*/", at + 2);
      end = end === -1 ? source.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      end = at + 1;
      while (end < source.length && source[end] !== c) end += source[end] === "\\" ? 2 : 1;
      end += 1;
    } else {
      out += c;
      at += 1;
      continue;
    }
    // Quotes kept, so a blanked string still reads as an argument.
    const blank = " ".repeat(Math.max(0, end - at - 2));
    out += c === "/" ? " ".repeat(end - at) : `${c}${blank}${c}`;
    at = end;
  }
  return out;
}

/** The text of each `new Setting(…)…` statement, up to its closing semicolon. */
function statements(source: string): string[] {
  const blanked = code(source);
  const found: string[] = [];
  let from = blanked.indexOf("new Setting(");
  while (from !== -1) {
    let depth = 0;
    let end = from;
    for (; end < blanked.length; end++) {
      const c = blanked[end];
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      if (depth < 0 || (depth === 0 && c === ";")) break;
    }
    // Read back from the source, so the names stay as written.
    found.push(source.slice(from, end));
    from = blanked.indexOf("new Setting(", end);
  }
  return found;
}

/** The chain's own calls, with callback bodies left out. */
function ownCalls(statement: string): string {
  const blanked = code(statement);
  let depth = 0;
  let out = "";
  for (let at = 0; at < statement.length; at++) {
    const c = blanked[at];
    if (c === "(" || c === "{" || c === "[") depth++;
    if (depth <= 1) out += statement[at];
    if (c === ")" || c === "}" || c === "]") depth--;
  }
  return out;
}

describe("settings rows", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("finds the settings modules", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("is not misled by a bracket in a string or a comment", () => {
    const source = [
      'new Setting(el).setName("a (b").addText(() => {}); // )',
      'new Setting(el).setName(":)").setDesc("x");',
      "/* new Setting(el).setName(c); */"
    ].join("\n");
    const chains = statements(source).map(ownCalls);
    expect(chains).toHaveLength(2);
    expect(chains[0]).not.toContain(".setDesc(");
    expect(chains[1]).toContain(".setDesc(");
  });

  for (const file of files) {
    it(`${file}: every named row has a description`, () => {
      const source = readFileSync(join(DIR, file), "utf8");
      const bare = statements(source)
        .map(ownCalls)
        .filter((chain) => chain.includes(".setName("))
        .filter((chain) => !chain.includes(".setDesc(") && !chain.includes(".setHeading("))
        .map((chain) => /\.setName\(([^)]*)\)/.exec(chain)?.[1] ?? chain)
        .filter((name) => !DESCRIBED_LATER.has(name.trim()));
      expect(bare).toEqual([]);
    });
  }
});
