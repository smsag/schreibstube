import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Recommended is drawn as the note's register: a rank in a marker column, the
 * title as a link, one line under it. Every title starts on the same edge.
 *
 * The first drawing of this layout put a column gap on the picture's row only,
 * so its title stood 16px right of every other title. That was a slip in the
 * drawing, not the design: the thumbnail keeps its distance with its own
 * margin, and the row grid has no gap that could move the text.
 */
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** A selector list's arms: split at its own commas, not at those inside an
 *  `:is(…)`, whose members are not selectors of the rule on their own. */
function arms(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let arm = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(arm.trim());
      arm = "";
    } else arm += ch;
  }
  out.push(arm.trim());
  return out;
}

/** Every rule whose selector list contains `selector` exactly, as its body. */
function bodies(selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) => arms(sel ?? "").some((s) => s === selector))
    .map(([, , body]) => body ?? "");
}

describe("Recommended as a register", () => {
  it("gives no row a gap between its columns, so no title leaves the shared edge", () => {
    const row = bodies(".schreibstube-related-card");
    expect(row.length).toBeGreaterThan(0);
    for (const body of row) {
      expect(body).toMatch(
        /grid-template-columns:\s*var\(--schreibstube-related-rank\) minmax\(0, 1fr\) auto auto;/
      );
      expect(body).not.toMatch(/(^|[\s;])(column-)?gap\s*:/);
    }
    for (const kind of [
      ".schreibstube-related-card.is-picture",
      ".schreibstube-related-card.is-conversation"
    ]) {
      expect(bodies(kind), `${kind} must not restyle the row`).toEqual([]);
    }
  });

  it("keeps the thumbnail apart by its own margin, at the end of the row", () => {
    const [thumb] = bodies(".schreibstube-related-card-thumb");
    expect(thumb).toMatch(/margin-left:\s*var\(--schreibstube-related-thumb-gap\);/);
    expect(thumb).not.toMatch(/margin-right|(^|[\s;])order\s*:/);
  });

  it("moves the editor's end-of-note padding below the footer, so it starts where the note ends", () => {
    // Obsidian pads the editor's content by half its height; the footer came
    // after that padding and sat half a screen below the note (measured: 428px
    // in a 760px pane, against 48px in Reading view).
    const [editing] = bodies(".cm-sizer > .cm-contentContainer + .schreibstube-recommended-footer");
    expect(editing).toMatch(/margin-top:\s*calc\(3em - var\(--schreibstube-editor-tail, 0px\)\);/);
    expect(editing).toMatch(/padding-bottom:\s*var\(--schreibstube-editor-tail, 0px\);/);
    expect(editing).toMatch(/position:\s*relative;/);
  });

  it("takes the width of the text under it, not a width of its own", () => {
    // Both hosts sit in the sizer Obsidian narrows only with readable line
    // length on; a max-width here narrowed the footer with it off. And
    // .cm-sizer is a flex column, where auto side margins shrink the footer to
    // its longest title (measured 254px in a 948px editor).
    const [footer] = bodies(".schreibstube-recommended-footer");
    expect(footer).not.toMatch(/(max-)?width\s*:/);
    expect(footer).not.toMatch(/margin[^;]*\bauto\b/);
    expect(footer).not.toMatch(/margin-(left|right|inline)[^;]*:/);
  });

  it("does not take Reading view's list indent", () => {
    // Obsidian's `.markdown-rendered ol > li` indents 3ch; the footer is inside it.
    const [item] = bodies(".schreibstube-recommended-footer .schreibstube-related-list > li");
    expect(item).toMatch(/margin-inline-start:\s*0;/);
  });

  it("hides an entry's actions only where there is a pointer to bring them back", () => {
    // On a phone there is no hover: hidden there, they could never be pressed.
    const hover = css.match(/@media \(hover: hover\) \{([\s\S]*?)\n\}/g) ?? [];
    const hiding = hover.filter((block) =>
      /schreibstube-related-actions[^{]*\{[^}]*visibility:\s*hidden/.test(block)
    );
    expect(hiding.length).toBe(1);
    expect(hiding[0]).toMatch(/:not\(:hover\):not\(:focus-within\)/);
    const [actions] = bodies(".schreibstube-related-actions");
    expect(actions).not.toMatch(/visibility|display:\s*none|opacity/);
  });

  it("draws no number of a theme's in front of an entry", () => {
    // Klartext numbers every `.markdown-rendered ol > li` with a ::before.
    for (const where of [".schreibstube-recommended-footer", ".schreibstube-related-notes"]) {
      const [body] = bodies(`${where} .schreibstube-related-list > li::before`);
      expect(body, where).toMatch(/content:\s*none;/);
    }
  });

  it("sets the list under a note at the sidebar's size, not the note's", () => {
    const [footer] = bodies(".schreibstube-recommended-footer");
    expect(footer).toMatch(/font-size:\s*var\(--font-ui-small\);/);
  });

  it("draws the reasons as words on the line, never as chips", () => {
    expect(css).not.toMatch(/schreibstube-related-chip/);
  });

  it("never uses --text-faint for what an entry is or why it is there", () => {
    const [meta] = bodies(".schreibstube-related-card-meta");
    expect(meta).toMatch(/color:\s*var\(--text-muted\);/);
  });
});
