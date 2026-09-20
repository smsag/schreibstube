import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every glyph in the review panel means one thing.
 *
 * This panel is a queue: accept, reject and show repeat once per suggestion
 * card, so a person targets the glyph and reads the word only to confirm. That
 * is what earns these buttons an icon at all — and it is also what makes a
 * repeated glyph worse here than anywhere else. Two of them had collided:
 * `x` was both "stop the run" and "reject this suggestion", and the panel's
 * own leaf-tab icon would have sat on its primary button as well.
 *
 * The rule this holds: within the panel, one glyph, one meaning — the view's
 * identity icon included.
 */
const source = readFileSync(new URL("../ui/review-panel.ts", import.meta.url), "utf8");

/** The text of a call to `fn(`, parentheses balanced. */
function calls(fn: string): string[] {
  const out: string[] = [];
  for (let at = source.indexOf(fn); at !== -1; at = source.indexOf(fn, at + 1)) {
    let depth = 0;
    let end = at + fn.length - 1;
    do {
      if (source[end] === "(") depth++;
      else if (source[end] === ")") depth--;
      end++;
    } while (depth > 0 && end < source.length);
    out.push(source.slice(at, end));
  }
  return out;
}

/**
 * Top-level arguments of a call, split on the commas that are not nested.
 *
 * Comments come out FIRST: a `//` line explaining a choice is allowed to
 * contain a comma, and stripping per-argument instead of per-call would let
 * that comma split the list and shift every argument after it.
 */
function args(call: string): string[] {
  const inner = call
    .slice(call.indexOf("(") + 1, call.lastIndexOf(")"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out.map((a) => a.trim());
}

/**
 * The icon each `this.button(...)` passes: its third argument, read by
 * position rather than by "the first string literal in the call". The loose
 * version passed today and would have read a role, or a literal out of an
 * arrow body, the first time an argument moved — a guard that quietly measures
 * the wrong thing is worse than none.
 */
function buttonIcons(): (string | null)[] {
  return calls("this.button(").map((call) => {
    const icon = args(call)[2];
    expect(icon, `no third argument in:\n${call}`).toBeDefined();
    if (icon === "null") return null;
    const literal = /^"([^"]+)"$/.exec(icon ?? "")?.[1];
    expect(literal, `the icon argument is not a literal or null:\n${icon}`).toBeDefined();
    return literal ?? null;
  });
}

describe("the review panel's glyphs", () => {
  it("builds at least the eight buttons this panel is made of", () => {
    expect(buttonIcons().length).toBeGreaterThanOrEqual(8);
  });

  it("never uses one glyph for two meanings", () => {
    const used = buttonIcons().filter((i): i is string => i !== null);
    const seen = new Map<string, number>();
    for (const icon of used) seen.set(icon, (seen.get(icon) ?? 0) + 1);
    const repeated = [...seen].filter(([, n]) => n > 1).map(([icon, n]) => `${icon} ×${n}`);
    expect(repeated, "a glyph is doing two jobs in one panel").toEqual([]);
  });

  it("keeps the view's identity icon off its own buttons", () => {
    const identity = /override getIcon\(\): string \{\s*return "([^"]+)"/.exec(source);
    expect(identity, "the view no longer declares an icon; update this guard").not.toBeNull();
    expect(buttonIcons(), `${identity![1]} is the leaf tab's icon`).not.toContain(identity![1]);
  });
});
