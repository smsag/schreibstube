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
 * The icon each `this.button(...)` passes: `null`, or the first string literal
 * in the call. The label ahead of it is always a `t()` expression and the role
 * behind it always follows, so "first literal" is the icon — and if that ever
 * stops being true this reads the wrong thing and fails loudly rather than
 * passing quietly.
 */
function buttonIcons(): (string | null)[] {
  return calls("this.button(").map((call) => {
    const args = call.slice(call.indexOf("(") + 1);
    if (/,\s*null\s*,/.test(args)) return null;
    const literal = /"([^"]+)"/.exec(args.replace(/\/\/[^\n]*/g, ""))?.[1];
    expect(literal, `no icon argument found in:\n${call}`).toBeDefined();
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
