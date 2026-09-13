import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLE_TEMPLATES } from "./print-examples";

/**
 * The generated module against the folders it was generated from.
 *
 * Two copies of the same template is a thing that rots: somebody improves the
 * letter in `examples/print/` and the one the plugin lays down stays as it was,
 * and nobody notices until a person compares the two. This is the noticing.
 */
describe("the templates the plugin carries", () => {
  it("carries both examples", () => {
    expect(EXAMPLE_TEMPLATES.map((template) => template.name)).toEqual(["Brief", "Lebenslauf"]);
  });

  it("matches the folders it was generated from, byte for byte", () => {
    for (const template of EXAMPLE_TEMPLATES) {
      for (const file of template.files) {
        const onDisk = readFileSync(`${template.source}/${file.name}`, "utf8");
        expect(
          file.text,
          `${template.source}/${file.name} has drifted — run
        node scripts/build-print-examples.mjs`
        ).toBe(onDisk);
      }
    }
  });

  it("gives every template the two files one cannot do without, first", () => {
    for (const template of EXAMPLE_TEMPLATES) {
      const names = template.files.map((file) => file.name);
      expect(names.slice(0, 2)).toEqual(["template.md", "template.typ"]);
      for (const file of template.files) expect(file.text.length).toBeGreaterThan(0);
    }
  });

  it("carries no font, because a typeface is licensed", () => {
    for (const template of EXAMPLE_TEMPLATES) {
      expect(template.files.some((file) => /\.(ttf|otf)$/i.test(file.name))).toBe(false);
    }
  });
});
