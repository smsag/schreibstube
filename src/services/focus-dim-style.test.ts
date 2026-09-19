import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, MAX_DIM_OPACITY, MIN_DIM_OPACITY } from "./focus-settings";

/**
 * The dim strength is one setting, and both focus modes have to read it.
 *
 * Paragraph mode dims a whole line, so it can use opacity. Sentence mode
 * cannot: the focused sentence sits inside the dimmed line, and opacity on an
 * ancestor is a ceiling its children cannot rise above. It therefore dims by
 * colour — and for a while it dimmed to a fixed `--text-muted`, which ignored
 * the setting and, measured in Obsidian, changed the luminance the eye judges
 * by 6.2% on a light page against 42.2% on a dark one. Mixing toward
 * `--background-primary` by the setting's own fraction is what makes the two
 * modes agree and the dim scale with the page.
 *
 * The rules live in CSS, so this is the only place that can hold the line.
 */
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `${selector} is missing from styles.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const PARAGRAPH_DIM = ".schreibstube-focus-enabled .cm-line.schreibstube-focus-dimmed";
const SENTENCE_DIM =
  ".schreibstube-focus-enabled.schreibstube-focus-mode-sentence .cm-line.schreibstube-focus-dimmed";

describe("focus dim styling", () => {
  it("dims a whole line with the setting's opacity", () => {
    expect(ruleBody(PARAGRAPH_DIM)).toContain("opacity: var(--schreibstube-focus-dim-opacity)");
  });

  it("dims a sentence-mode line by the same setting, not a fixed token", () => {
    const body = ruleBody(SENTENCE_DIM);
    expect(body).toContain("--schreibstube-focus-dim-opacity");
    expect(body).not.toContain("var(--text-muted)");
  });

  it("mixes toward the page, so the dim scales with light and dark", () => {
    const body = ruleBody(SENTENCE_DIM);
    expect(body).toContain("color-mix");
    expect(body).toContain("var(--text-normal)");
    expect(body).toContain("var(--background-primary)");
  });

  it("keeps opacity out of the sentence-mode rule's way", () => {
    // The focused sentence has to be able to rise above its line again.
    expect(ruleBody(SENTENCE_DIM)).toContain("opacity: 1");
  });

  it("declares a fallback dim strength inside the settings' own range", () => {
    const root = ruleBody(":root");
    const declared = /--schreibstube-focus-dim-opacity:\s*([\d.]+)/.exec(root);
    expect(declared, "styles.css must declare a fallback dim strength").not.toBeNull();
    const value = Number(declared?.[1]);
    expect(value).toBeGreaterThanOrEqual(MIN_DIM_OPACITY);
    expect(value).toBeLessThanOrEqual(MAX_DIM_OPACITY);
    expect(value).toBe(DEFAULT_SETTINGS.focusDimOpacity);
  });
});
