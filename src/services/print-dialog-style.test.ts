import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The print dialog keeps its buttons on screen.
 *
 * Its page preview used to be sized on its own, at 68vh. With the page count,
 * four warnings and the footer around it the dialog needed 744px of the 678px
 * Obsidian gave it in a 1024 × 800 window, scrolled, and put Print below the
 * bottom edge. Now the dialog is a column that Obsidian caps, and the preview
 * takes what is left.
 */
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

function body(selector: string): string {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) =>
    (sel ?? "").split(",").some((s) => s.trim() === selector)
  );
  expect(rule, selector).toBeDefined();
  return rule?.[2] ?? "";
}

describe("the print dialog", () => {
  it("is a column that does not scroll itself", () => {
    const dialog = body(".schreibstube-print-dialog");
    expect(dialog).toMatch(/display:\s*flex;/);
    expect(dialog).toMatch(/flex-direction:\s*column;/);
    expect(dialog).toMatch(/overflow:\s*hidden;/);
    expect(body(".schreibstube-print-dialog > .modal-content")).toMatch(/min-height:\s*0;/);
    expect(body(".schreibstube-print-dialog-body")).toMatch(/min-height:\s*0;/);
  });

  it("sizes the pages by the room left, never by the window", () => {
    const pages = body(".schreibstube-print-dialog-pages");
    expect(pages).toMatch(/flex:\s*1 1 auto;/);
    expect(pages).toMatch(/overflow-y:\s*auto;/);
    expect(pages).not.toMatch(/\d+vh/);
  });

  it("lets a long list of warnings scroll in its own box", () => {
    const warnings = body(".schreibstube-print-dialog-warnings");
    expect(warnings).toMatch(/max-height:/);
    expect(warnings).toMatch(/overflow-y:\s*auto;/);
    expect(warnings).toMatch(/flex:\s*none;/);
  });
});
