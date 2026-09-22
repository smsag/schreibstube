import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUNDS_MEASURED_IN, THEME_GROUNDS, UI_BOUNDARY_CONTRAST } from "../testing/theme-grounds";

/**
 * The explorer's filter field has a boundary you can see, and says focus.
 *
 * It was a filled box with an inset hairline of --background-modifier-border —
 * a token meant for the seam between two surfaces. Measured, that edge came
 * out at 1.23:1 under Klartext in light, and in dark at exactly 1.00:1:
 * Obsidian sets the form-field fill to the same #2e2e2e that token resolves
 * to, so fill and edge were one colour and there was no edge at all. WCAG
 * 1.4.11 asks 3:1 for the boundary of a control.
 *
 * The percentages cannot be checked against "the theme", because a plugin does
 * not get one. They are checked against the themes that were measured
 * (`src/testing/theme-grounds.ts`) by recomputing the composite here, so
 * lowering one fails rather than merely looking different.
 */
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/** The declarations of the rule a selector OPENS, comments stripped. A
 *  selector that also ends a grouped rule would otherwise match that one. */
function ruleBody(selector: string): string {
  for (let at = css.indexOf(selector); at !== -1; at = css.indexOf(selector, at + 1)) {
    if (css.slice(0, at).trimEnd().endsWith(",")) continue;
    const open = css.indexOf("{", at);
    return css.slice(open + 1, css.indexOf("}", open)).replace(/\/\*[\s\S]*?\*\//g, "");
  }
  return expect.fail(`${selector} is missing from styles.css`);
}

/** The mix percentage the sheet declares for a mode, as a fraction. */
function declaredMix(mode: "light" | "dark"): number {
  const body = ruleBody(`.theme-${mode} .schreibstube-explorer {`);
  const m =
    /--schreibstube-field-rule:\s*color-mix\(in srgb, var\(--text-normal\) (\d+)%, transparent\)/.exec(
      body
    );
  if (m === null) {
    return expect.fail(
      `.theme-${mode} .schreibstube-explorer must mix the rule from --text-normal`
    );
  }
  return Number(m[1]) / 100;
}

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(… X%, transparent)` over an opaque ground is a plain blend. */
function composite(text: string, ground: string, mix: number): Rgb {
  const [tr, tg, tb] = rgb(text);
  const [gr, gg, gb] = rgb(ground);
  const blend = (t: number, g: number): number => Math.round(mix * t + (1 - mix) * g);
  return [blend(tr, gr), blend(tg, gg), blend(tb, gb)];
}

describe(`the explorer's filter field, against ${GROUNDS_MEASURED_IN}`, () => {
  for (const mode of ["light", "dark"] as const) {
    for (const [theme, grounds] of Object.entries(THEME_GROUNDS[mode])) {
      it(`stands ${UI_BOUNDARY_CONTRAST}:1 clear of every ${theme} ground in ${mode}`, () => {
        for (const background of grounds.backgrounds) {
          const painted = composite(grounds.text, background, declaredMix(mode));
          const ratio = contrast(painted, rgb(background));
          expect(
            ratio,
            `rgb(${painted.join(" ")}) on ${background} is ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(UI_BOUNDARY_CONTRAST);
        }
      });
    }
  }

  it("mixes a different amount per mode, because one number cannot do both", () => {
    // White is at the end of the luminance scale and a dark ground is not, so
    // the same percentage lands in two different places.
    expect(declaredMix("light")).not.toBe(declaredMix("dark"));
  });

  it("draws no box: no fill, no radius, no ring", () => {
    const field = ruleBody(".schreibstube-explorer input.schreibstube-explorer-filter {");
    expect(field).toMatch(/background-color:\s*transparent;/);
    expect(field).toMatch(/border-radius:\s*0;/);
    expect(field).toMatch(/box-shadow:\s*none;/);
  });

  it("draws its boundary with the measured rule, never a border token", () => {
    const field = ruleBody(".schreibstube-explorer input.schreibstube-explorer-filter {");
    expect(field).toMatch(/border-bottom:\s*1px solid var\(--schreibstube-field-rule\);/);
    expect(field).not.toMatch(/--background-modifier-border/);
    // That token is what made the dark field's edge 1.00:1 against its own fill.
    expect(field).not.toMatch(/--background-modifier-form-field/);
  });

  it("names `input` and `:not(:disabled)`, or Obsidian takes the field back", () => {
    // Measured: `input[type='search']` sets height at (0,1,1), which beats a
    // class rule — the field asked for 32px and got 30. And
    // `input[type='search']:not(:disabled):hover` sets BOTH background-color
    // and border-color at (0,3,1), so a hover rule at (0,3,0) loses the fill
    // and the edge as soon as a pointer crosses the field. Every selector here
    // has to out-rank those, and the compiler cannot say so.
    for (const state of ["hover", "focus", "focus-visible", "active"]) {
      expect(css, `:${state} must be stated at a specificity that beats app.css`).toContain(
        `input.schreibstube-explorer-filter:not(:disabled):${state}`
      );
    }
    // The base rule names the element too, for the height.
    expect(css).toContain(".schreibstube-explorer input.schreibstube-explorer-filter {");
  });

  it("holds the rest colour on hover rather than letting it be repainted", () => {
    const hover = ruleBody(
      ".schreibstube-explorer input.schreibstube-explorer-filter:not(:disabled):hover {"
    );
    expect(hover).toMatch(/background-color:\s*transparent;/);
    expect(hover).toMatch(/border-bottom-color:\s*var\(--schreibstube-field-rule\);/);
  });

  it("says focus with the accent on the rule, and never a ring", () => {
    const focus = ruleBody(
      ".schreibstube-explorer input.schreibstube-explorer-filter:not(:disabled):focus,"
    );
    expect(focus).toMatch(/border-bottom:\s*2px solid var\(--interactive-accent\);/);
    // The pane clips what leaves it: a ring loses its upper edge and reads as
    // a rendering fault rather than as focus.
    expect(focus).toMatch(/box-shadow:\s*none;/);
    expect(focus).toMatch(/outline:\s*none;/);
  });

  it("leaves room for the loupe and the clear button, at its own height", () => {
    // Either one running under what is typed is the reason the padding is
    // asymmetric; a shorthand that forgets a side is the regression. The
    // height sits in the same rule because it is the one that out-ranks
    // Obsidian's `input[type='search'] { height: var(--input-height) }`.
    const field = ruleBody(".schreibstube-explorer input.schreibstube-explorer-filter {");
    expect(field).toMatch(/padding:\s*0 26px 0 22px;/);
    expect(field).toMatch(/height:\s*32px;/);
  });

  it("draws the loupe in --text-muted, never --text-faint", () => {
    // The role set rules faint out for a control: 2.3:1 on white.
    const loupe = ruleBody(".schreibstube-explorer .schreibstube-explorer-filter-loupe {");
    expect(loupe).toMatch(/color:\s*var\(--text-muted\)/);
    expect(loupe).not.toMatch(/--text-faint/);
    // It is a mark, not a target — the field behind it must stay clickable.
    expect(loupe).toMatch(/pointer-events:\s*none/);
  });

  it("keeps the clear button hidden until there is something to clear", () => {
    // Unchanged by this work, and worth holding: the field says so itself.
    expect(css).toContain(
      ".schreibstube-explorer-filter:placeholder-shown ~ .schreibstube-explorer-filter-clear"
    );
  });
});
