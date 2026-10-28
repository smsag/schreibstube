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

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, list = "", body = ""]) => ({
  arms: list.split(",").map((arm) => arm.replace(/\s+/g, " ").trim()),
  body
}));

/** The body of the rule whose selector list holds `selector` as one of its arms. */
function ruleFor(selector: string): string {
  const rule = rules.find((candidate) => candidate.arms.includes(selector));
  if (!rule) throw new Error(`${selector} is missing from styles.css`);
  return rule.body;
}

const BARE_ARMS = rules
  .flatMap((rule) => rule.arms)
  .filter((arm) => arm.includes("schreibstube-draft-bare"));

describe("the bare new note", () => {
  it.each([
    ".schreibstube-draft-bare > .view-header",
    ".schreibstube-draft-bare .embedded-backlinks",
    ".schreibstube-draft-bare .schreibstube-overlay",
    ".schreibstube-draft-bare .cm-gutters",
    ".schreibstube-draft-bare-window .mobile-navbar",
    ".schreibstube-draft-bare .cm-scroller::-webkit-scrollbar"
  ])("hides %s", (selector) => {
    expect(ruleFor(selector)).toMatch(/display:\s*none/);
  });

  it.each([
    ".schreibstube-draft-bare .inline-title:not(:focus)",
    ".schreibstube-draft-bare .metadata-container:not(:focus-within)"
  ])("folds %s away until it is reached", (selector) => {
    // Not displayed, the title and the properties could not take the focus,
    // and renaming the note or adding a property would type into nothing.
    const body = ruleFor(selector);
    expect(body).toMatch(/height:\s*0/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/display:\s*none/);
  });

  it("never takes the title or the properties out of the layout", () => {
    for (const arm of BARE_ARMS.filter((a) => /inline-title|metadata-container/.test(a))) {
      expect(ruleFor(arm), arm).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    }
  });

  it("hides the scroll bar without taking away the scrolling", () => {
    const body = ruleFor(".schreibstube-draft-bare .cm-scroller");
    expect(body).toMatch(/scrollbar-width:\s*none/);
    expect(body).not.toMatch(/overflow/);
  });

  it("empties only the note's own tab strip, never a sidebar's", () => {
    // On a tablet the note opens in the main window, where the sidebars'
    // strips are how their panes are switched.
    const strips = BARE_ARMS.filter((arm) => arm.includes("workspace-tab-header-container"));
    expect(strips.length).toBeGreaterThan(0);
    for (const arm of strips) expect(arm).toContain(".workspace-split.mod-root");
  });

  it("keeps the pop-out's tab bar as a place to drag the window", () => {
    expect(
      ruleFor(
        ".schreibstube-draft-bare-window .workspace-split.mod-root .workspace-tab-header-container > *"
      )
    ).toMatch(/-webkit-app-region:\s*drag/);
  });

  it("clears the clock on a phone only, where the header was all that did", () => {
    expect(ruleFor(".is-phone .schreibstube-draft-bare > .view-content")).toMatch(
      /safe-area-inset-top/
    );
    expect(BARE_ARMS.some((arm) => arm.startsWith(".is-mobile"))).toBe(false);
  });
});
