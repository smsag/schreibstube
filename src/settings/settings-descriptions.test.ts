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

/** The text of each `new Setting(…)…` statement, up to its closing semicolon. */
function statements(source: string): string[] {
  const found: string[] = [];
  let from = source.indexOf("new Setting(");
  while (from !== -1) {
    let depth = 0;
    let end = from;
    for (; end < source.length; end++) {
      const c = source[end];
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      if (depth < 0 || (depth === 0 && c === ";")) break;
    }
    found.push(source.slice(from, end));
    from = source.indexOf("new Setting(", end);
  }
  return found;
}

/** The chain's own calls, with callback bodies left out. */
function ownCalls(statement: string): string {
  let depth = 0;
  let out = "";
  for (const c of statement) {
    if (c === "(" || c === "{" || c === "[") depth++;
    if (depth <= 1) out += c;
    if (c === ")" || c === "}" || c === "]") depth--;
  }
  return out;
}

describe("settings rows", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("finds the settings modules", () => {
    expect(files.length).toBeGreaterThan(5);
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
