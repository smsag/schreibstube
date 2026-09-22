import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every hand-built button wears one of this plugin's nine roles.
 *
 * Obsidian sets a fill, a label colour, a height, a radius, a shadow and — on a
 * tablet or in a phone modal — a padding and a width on every `button` in the
 * document. A button that claims layout and nothing else gets all of it, which
 * is where each of these started. A role claims the lot back.
 *
 * Two things can rot: a role can stop claiming a property (which
 * `obsidian-cascade.test.ts` catches, by loading Obsidian's own rules ahead of
 * this sheet), and a new button can be created with no role at all. This file
 * is the second.
 */
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

const SCOPE = ":is(.schreibstube-review, .schreibstube-explorer, .schreibstube-icon-picker)";
const ROLES = [
  "primary",
  "secondary",
  "quiet",
  "destructive",
  "link",
  "icon",
  "seg",
  "tab",
  "chip-warn"
];

describe("the role set", () => {
  it("has a base rule that claims every property Obsidian's own sets", () => {
    const from = css.indexOf(`${SCOPE} .sb {`);
    expect(from, "the role base rule is missing").toBeGreaterThan(-1);
    const base = css.slice(from, css.indexOf("}", from));
    // Obsidian's bare `button` rule sets each of these; whatever a role does
    // not name, it inherits from the host.
    for (const prop of [
      "height",
      "width",
      "padding",
      "border",
      "border-radius",
      "corner-shape",
      "box-shadow",
      "background",
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "color"
    ]) {
      expect(base, `the base does not claim ${prop}`).toMatch(new RegExp(`(^|[;{\\s])${prop}:`));
    }
  });

  it("gives each of the nine roles a rule", () => {
    for (const role of ROLES) {
      expect(css, `no rule for sb-${role}`).toContain(`${SCOPE} .sb.sb-${role}`);
    }
  });

  it("reaches every colour through its contract property", () => {
    // A surface overrides one property rather than rewriting a rule. This
    // plugin overrides none — it has no contrast-computed label token of its
    // own, so the Obsidian defaults below are the honest values.
    const from = css.indexOf(`${SCOPE} .sb {`);
    // The block ends at its last rule, `[hidden]`, which the base needs because
    // the UA's `[hidden] { display: none }` loses to the base's `display`. An
    // anchor that goes missing must FAIL, not widen the slice to the whole
    // stylesheet — `indexOf` returning -1 would make `slice` measure almost
    // everything and pass regardless of where the tokens actually are.
    const to = css.indexOf(`${SCOPE} [hidden] {`, from);
    expect(from, "the role base rule is missing").toBeGreaterThan(-1);
    expect(to, "the block's closing [hidden] rule is missing").toBeGreaterThan(from);
    const block = css.slice(from, to);
    for (const [token, fallback] of [
      ["--btn-accent", "--color-accent"],
      ["--btn-on-accent", "--text-on-accent"],
      ["--btn-error", "--text-error"],
      ["--btn-warning", "--color-orange"]
    ]) {
      expect(block, `${token} is never read`).toContain(`var(${token}, var(${fallback}))`);
    }
    expect(css).not.toContain("--btn-on-accent:");
    expect(css).not.toContain("--btn-accent:");
  });
});

describe("every hand-built button names a role", () => {
  const sources = ["review-panel", "icon-picker", "explorer-view"].map((n) => ({
    name: n,
    text: readFileSync(new URL(`../ui/${n}.ts`, import.meta.url), "utf8")
  }));

  it.each(sources)("$name creates no <button> without one", ({ text }) => {
    // Obsidian's own dialog buttons come from Setting.addButton and keep
    // mod-cta and its siblings — the host's chrome, not ours. Only a button
    // this plugin builds by hand is covered.
    const built = text.matchAll(/createEl\(\s*"button"[\s\S]{0,180}?\)/g);
    for (const m of built) {
      // A literal role, or the review panel's factory, whose role parameter is
      // a union the next test pins.
      expect(m[0], `a hand-built button with no role:\n${m[0]}`).toMatch(
        /\bsb sb-(primary|secondary|quiet|destructive|link|icon|seg|tab|chip-warn|\$\{role\})(?![\w-])/
      );
    }
  });

  it("covers every button the review panel's factory makes", () => {
    const text = sources.find((s) => s.name === "review-panel")!.text;
    // The factory defaults to quiet; every call that wants another says so.
    expect(text).toMatch(/role: "primary" \| "secondary" \| "quiet" \| "destructive" = "quiet"/);
    expect((text.match(/this\.button\(/g) || []).length).toBeGreaterThan(0);
  });
});
