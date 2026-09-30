import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * On a phone, "Add property", "Add set" and "Suggest tags" stand one under the
 * other with their icons on one line. Side by side they wrapped wherever the
 * width ran out, and the control pushed to a line of its own started a step
 * in, by the gap meant for beside.
 */
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

function body(selectors: string[]): string | undefined {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => {
    const arms = (sel ?? "").split(",").map((s) => s.trim());
    return selectors.every((s) => arms.includes(s));
  })?.[2];
}

describe("the Properties widget's controls on a phone", () => {
  it("stacks Obsidian's and Schreibstube's with no step between their icons", () => {
    const rule = body([
      ".is-phone .metadata-container .metadata-add-button",
      ".is-phone .metadata-container .schreibstube-property-control"
    ]);
    expect(rule).toBeDefined();
    expect(rule).toMatch(/display:\s*flex;/);
    expect(rule).toMatch(/width:\s*fit-content;/);
    expect(rule).toMatch(/margin-inline-start:\s*0;/);
  });
});
