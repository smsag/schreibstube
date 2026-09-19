import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A marked run of text is drawn with the family's pen.
 *
 * Klartext is the baseline and `kit/highlight.css` in that repository is the
 * canonical text; this stylesheet carries a copy, because Obsidian loads every
 * plugin's CSS globally and a shared class name would couple the plugins to
 * each other. A copy drifts unless something holds it, and the numbers below
 * are that something — they are the kit's, verbatim.
 *
 * What this replaced: flat slabs from `--background-modifier-error` and
 * `--background-modifier-success`, tokens a theme picks for a toast or a form
 * field. Measured in Obsidian, they painted 312 and 277 from the page in
 * Euclidean RGB against the theme's own highlight at 70 — the loudest marks in
 * the family, and theme-dependent on top.
 */
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/**
 * The declarations of the rule this selector OPENS. A selector that also ends a
 * grouped rule would otherwise match that one: `.schreibstube-diff-delete {` is
 * the tail of the shared stroke rule as well as a rule of its own.
 */
function ruleBody(selector: string): string {
  for (let at = css.indexOf(selector); at !== -1; at = css.indexOf(selector, at + 1)) {
    if (!css.slice(0, at).trimEnd().endsWith(",")) {
      const open = css.indexOf("{", at);
      return css.slice(open + 1, css.indexOf("}", open));
    }
  }
  expect.fail(`${selector} is missing from styles.css`);
}

const STROKE = ".schreibstube-diff-delete,\n.schreibstube-diff-insert,\n.schreibstube-diff-flag {";

describe("the diff marks' stroke", () => {
  it("draws every diff mark with one rule, so they cannot diverge", () => {
    expect(css).toContain(STROKE);
  });

  it.each([
    ["--hl-angle", "104deg"],
    ["--hl-land-0", "0.2em"],
    ["--hl-land-1", "0.7em"],
    ["--hl-lift-1", "88%"],
    ["--hl-lift-0", "calc(100% - 0.28em)"],
    ["--hl-pad-y", "0.14em"],
    ["--hl-pad-x", "0.42em"]
  ])("keeps the kit's %s at %s", (prop, value) => {
    expect(ruleBody(STROKE)).toContain(`${prop}: ${value};`);
  });

  it("lays one stroke per line, which is where a wrapped diff run shows it", () => {
    const body = ruleBody(STROKE);
    // Anchored: a bare substring check on the unprefixed property is satisfied
    // by the -webkit- one, so dropping the standard property would pass.
    expect(body).toMatch(/(^|[;\s])box-decoration-break:\s*clone/m);
    expect(body).toMatch(/-webkit-box-decoration-break:\s*clone/);
  });

  it.each([
    ["border-radius", "0"],
    ["text-shadow", "none"],
    ["box-shadow", "none"]
  ])("keeps %s at the family's %s", (prop, value) => {
    expect(ruleBody(STROKE)).toContain(`${prop}: ${value};`);
  });

  it.each([
    ["insert", ".schreibstube-diff-insert {", "--color-green"],
    ["delete", ".schreibstube-diff-delete,\n.schreibstube-diff-flag {", "--color-red"]
  ])("inks %s from a named colour composited onto the page", (_n, selector, token) => {
    expect(ruleBody(selector)).toMatch(
      new RegExp(
        `--hl-ink:\\s*color-mix\\(in srgb, var\\(${token}\\) \\d+%, var\\(--background-primary\\)\\)`
      )
    );
  });

  it("never paints a run of text from a --background-modifier-* token", () => {
    // Those are a theme's UI-affordance colours: unbounded saturation, chosen
    // for a toast rather than for prose.
    for (const selector of [
      STROKE,
      ".schreibstube-diff-insert {",
      ".schreibstube-diff-delete,\n.schreibstube-diff-flag {"
    ]) {
      expect(ruleBody(selector)).not.toContain("--background-modifier-");
    }
  });

  it("keeps the strikethrough on a deletion and off an insertion", () => {
    expect(ruleBody(".schreibstube-diff-delete {")).toContain("text-decoration: line-through");
    expect(ruleBody(".schreibstube-diff-insert {")).not.toContain("line-through");
  });

  it("leaves the glossary underline alone — a different signal, not a highlight", () => {
    expect(ruleBody(".schreibstube-glossary-hit {")).toContain("underline wavy");
  });
});
