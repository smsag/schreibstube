import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every hand-built button wears one of the family's roles.
 *
 * `kit/button.css` is Pythia's — it is the family's baseline for buttons — and
 * this repository carries a copy, because Obsidian loads every plugin's CSS
 * globally and a shared class name would couple the plugins through whichever
 * loaded last. `styles.css` carries that copy INSTANTIATED.
 *
 * Two things can rot: the copy can drift from the kit, and a new button can be
 * created with no role, which puts it back on Obsidian's ten rules — which is
 * where all of these started. One test each.
 */
const kit = readFileSync(new URL("../../kit/button.css", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

const SCOPE = ":is(.schreibstube-review, .schreibstube-explorer, .schreibstube-icon-picker)";
const MODAL = ".modal.schreibstube-icon-picker";

/** The kit without its header comment: the rules a host instantiates. */
function kitRules(): string {
  const at = kit.indexOf("*/");
  expect(at, "kit/button.css must open with its header comment").toBeGreaterThan(-1);
  return kit
    .slice(at + 2)
    .replace(/^\n+/, "")
    .trimEnd();
}

describe("the button kit", () => {
  it("is still portable — every placeholder intact", () => {
    for (const ph of ["%%P%%", "%%SCOPE%%", "%%MODAL%%"]) {
      expect(kitRules(), `${ph} is gone; the copy can no longer be re-instantiated`).toContain(ph);
    }
  });

  it("is what styles.css renders, declaration for declaration", () => {
    // Not byte for byte: instantiating lengthens every selector, so Prettier
    // wraps the copy differently from the kit. Whitespace is collapsed and the
    // comparison is on the content, which is what can actually drift.
    const squash = (t: string) => t.replace(/\s+/g, " ").trim();
    const expected = squash(
      kitRules()
        .replace(/%%SCOPE%%/g, SCOPE)
        .replace(/%%MODAL%%/g, MODAL)
        .replace(/\.%%P%%/g, ".sb")
    );
    const flat = squash(css);
    const from = flat.indexOf(`${SCOPE} .sb {`);
    expect(from, "the instantiated base rule is missing from styles.css").toBeGreaterThan(-1);
    expect(flat.slice(from, from + expected.length)).toBe(expected);
  });

  it("leaves the colour contract at the kit's defaults", () => {
    // This plugin has no contrast-computed label token of its own, so it must
    // not pretend to: the kit's --text-on-accent default is the honest value.
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
