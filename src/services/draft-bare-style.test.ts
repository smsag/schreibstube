import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The new note opens with nothing on screen but its text. What is hidden is
 * fixed, not a setting, and lives only in CSS, so this is the one place that
 * can say a rule went missing — an inline title back above an empty page is
 * the first thing a writer sees.
 */
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** The body of the rule whose selector list holds `selector` as one of its arms. */
function ruleFor(selector: string): string {
  for (const [, list = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const arms = list.split(",").map((arm) => arm.trim());
    if (arms.includes(selector)) return body;
  }
  throw new Error(`${selector} is missing from styles.css`);
}

describe("the bare new note", () => {
  it.each([
    ".schreibstube-draft-bare > .view-header",
    ".schreibstube-draft-bare .inline-title",
    ".schreibstube-draft-bare .metadata-container",
    ".schreibstube-draft-bare .embedded-backlinks",
    ".schreibstube-draft-bare .schreibstube-overlay",
    ".schreibstube-draft-bare .cm-gutters",
    ".schreibstube-draft-bare-window .mobile-navbar",
    ".schreibstube-draft-bare .cm-scroller::-webkit-scrollbar"
  ])("hides %s", (selector) => {
    expect(ruleFor(selector)).toMatch(/display:\s*none/);
  });

  it("hides the scroll bar without taking away the scrolling", () => {
    const body = ruleFor(".schreibstube-draft-bare .cm-scroller");
    expect(body).toMatch(/scrollbar-width:\s*none/);
    expect(body).not.toMatch(/overflow/);
  });

  it("keeps the pop-out's tab bar as a place to drag the window", () => {
    expect(ruleFor(".schreibstube-draft-bare-window .workspace-tab-header-container > *")).toMatch(
      /-webkit-app-region:\s*drag/
    );
  });
});
