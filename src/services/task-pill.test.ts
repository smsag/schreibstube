import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The task tally's pill keeps one rule set, an accent fill, and the row's own
 * weight.
 *
 * It is drawn on two surfaces — the file pane's rows and the pinned-tag cards
 * — and it held a copy of the look for each. They drifted, and a padding
 * changed in one of them is a bug that only shows when both panes are open.
 * So the look lives once, in `.schreibstube-tasks`, and a surface's own class
 * may say how big the figures are and where they sit and nothing else.
 *
 * The fill is MEASURED, not chosen: at 18% of --interactive-accent it paints
 * rgb(236 230 254) over a white page and rgb(46 38 65) over rgb(26 26 26),
 * holding 10.4:1 and 9.6:1 against --text-normal. That contrast is what lets
 * the figures sit at the body weight — the tint does the finding, so the
 * numbers do not have to be bold to be found. Lower the percentage and the
 * bold comes back; that is the regression this file is here to catch.
 */
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/** The declarations of the rule a selector opens, comments stripped. */
function ruleBody(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) expect.fail(`${selector} is missing from styles.css`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open)).replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every declared property of every rule whose selector mentions the tally. */
function tallyDeclarations(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? "").trim();
    if (/tasks/.test(selector)) out.push({ selector, body: m[2] ?? "" });
  }
  return out;
}

describe("the task tally's pill", () => {
  it("draws the whole look in one rule, so the two surfaces cannot diverge", () => {
    const shared = ruleBody(".schreibstube-tasks");
    expect(shared).toMatch(/padding:/);
    expect(shared).toMatch(/background:/);
    expect(shared).toMatch(/border-radius:/);
  });

  it("leaves a surface nothing but its size and its place", () => {
    // The look is not restated per surface. `font-size` differs on purpose —
    // the pane's rows take the row's size, the cards a smaller one — and the
    // pane's tally is right-aligned in the slack the name gives up.
    const allowed = /^(font-size|text-align)$/;
    for (const base of [".schreibstube-explorer-tasks", ".schreibstube-tag-card-tasks"]) {
      const props = ruleBody(base)
        .split(";")
        .map((d) => (d.split(":")[0] ?? "").trim())
        .filter(Boolean);
      expect(props.length).toBeGreaterThan(0);
      for (const prop of props) expect(prop).toMatch(allowed);
    }
  });

  it("sets the figures at the row's weight, never bold", () => {
    // The tint is what makes the column findable. A weight here would be the
    // same emphasis arriving twice, inside a pill on a line of plain names.
    for (const { selector, body } of tallyDeclarations()) {
      expect(`${selector}: ${body}`).not.toMatch(/font-weight/);
    }
  });

  it("fills with the accent, never a neutral", () => {
    // The rows' own hover and active states are washes of
    // --background-modifier-hover. A neutral tint would be that colour
    // arriving twice and would vanish under the pointer; an accent wash
    // composites on top of them and survives.
    const fill =
      /background:\s*color-mix\(in srgb, var\(--interactive-accent\) (\d+)%, transparent\)/.exec(
        ruleBody(".schreibstube-tasks")
      );
    expect(fill, "the fill must stay a color-mix of --interactive-accent").not.toBeNull();
    // Below the measured 18% the wash reads as grey rather than as the accent,
    // which is the state the bold was compensating for.
    expect(Number(fill?.[1])).toBeGreaterThanOrEqual(18);
  });

  it("pads the figures off the fill's edge", () => {
    expect(ruleBody(".schreibstube-tasks")).toMatch(/padding:\s*2px 8px;/);
  });

  it("carries the padding on a finished note too, so the column stays level", () => {
    // Only the fill goes: a tally with nothing open must not sit a few pixels
    // narrower than the rows above and below it.
    const done = ruleBody('.schreibstube-tasks[data-state="done"]');
    expect(done).toMatch(/background:\s*transparent;/);
    expect(done).not.toMatch(/padding/);
  });
});
