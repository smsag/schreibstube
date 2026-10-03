import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * On the desktop, the strip of tab headers at the top of Obsidian's window is
 * a window-drag area, and the window takes every click inside one whatever is
 * drawn over it. The slideshow's fullscreen view covered the window without
 * opting out, and the cross in its top right corner never closed it: the
 * click went to the window. Anything of the plugin's that covers the whole
 * window opts out, as Obsidian's own dialogs do.
 */

const STYLES = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

/** Each rule's selector and body, comments dropped so they cannot fake a declaration. */
function rules(css: string): Array<{ selector: string; body: string }> {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? "").trim(),
    body: m[2] ?? ""
  }));
}

describe("an overlay over the whole window", () => {
  const overlays = rules(STYLES).filter(
    ({ body }) => /position:\s*fixed/.test(body) && /inset:\s*0\s*;/.test(body)
  );

  it("is found, so the guard below guards something", () => {
    expect(overlays.map((rule) => rule.selector)).toContain(".schreibstube-slideshow-fs");
  });

  it("keeps its clicks from the window's drag area", () => {
    for (const { selector, body } of overlays) {
      expect(body, selector).toMatch(/-webkit-app-region:\s*no-drag/);
    }
  });
});
