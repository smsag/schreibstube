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

/** Every rule whose selector list contains `selector` exactly, as its body. */
function bodies(selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) => (sel ?? "").split(",").some((s) => s.trim() === selector))
    .map(([, , body]) => body ?? "");
}

describe("Recommended as a register", () => {
  it("gives no row a gap between its columns, so no title leaves the shared edge", () => {
    const row = bodies(".schreibstube-related-card");
    expect(row.length).toBeGreaterThan(0);
    for (const body of row) {
      expect(body).toMatch(
        /grid-template-columns:\s*var\(--schreibstube-related-rank\) minmax\(0, 1fr\) auto;/
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

  it("draws the reasons as words on the line, never as chips", () => {
    expect(css).not.toMatch(/schreibstube-related-chip/);
  });

  it("never uses --text-faint for what an entry is or why it is there", () => {
    const [meta] = bodies(".schreibstube-related-card-meta");
    expect(meta).toMatch(/color:\s*var\(--text-muted\);/);
  });
});
