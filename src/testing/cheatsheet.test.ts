/**
 * The cheatsheet a person hands a language model, held to what the plugin
 * reads.
 *
 * `docs/CHEATSHEET.md` is the one page that tells a model how to write a note
 * Schreibstube understands. A page like that goes stale quietly: a key is
 * added and never mentioned, or one is renamed and the page keeps teaching the
 * old one, and the model writes notes that do nothing. So the names are taken
 * from the code and checked both ways — every one the plugin reads is on the
 * page, and every `schreibstube…` key on the page is one the plugin reads.
 * What the page says about them is checked by a person before each release;
 * `scripts/release.mjs` refuses a version the page was not checked against.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_TEMPLATES } from "../services/print-examples";
import { SLIDE_FORMATS } from "../services/print-options";
import { REQUESTED_LAYOUTS, SLIDE_ALIGNS, SLIDE_DIRECTIVES } from "../services/print-slides";
import { SLIDESHOW_LANGUAGE, SLIDESHOW_LAYOUTS } from "../services/slideshow";
import { TASK_SUMMARY_LANGUAGE } from "../services/task-summary";

/** The page's length limit: past it, a model reads it less carefully and a person not at all. */
export const MAX_CHEATSHEET_LINES = 500;

const root = join(import.meta.dirname, "..", "..");
const sheet = readFileSync(join(root, "docs", "CHEATSHEET.md"), "utf8");

/** Every file under a folder, for reading the keys out of the source. */
function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

/**
 * The frontmatter keys the plugin reads or writes, as its services spell them:
 * a string literal, or a descriptor field read as `record.schreibstube…`.
 */
function keysInCode(): Set<string> {
  const keys = new Set<string>();
  for (const path of sources(join(root, "src", "services"))) {
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(
      /"(schreibstube[A-Z][A-Za-z]*)"|record\.(schreibstube[A-Z][A-Za-z]*)/g
    )) {
      keys.add(match[1] ?? match[2] ?? "");
    }
  }
  keys.delete("");
  return keys;
}

/** The formula names a table cell accepts, from the pattern that reads them. */
function formulasInCode(): string[] {
  const text = readFileSync(join(root, "src", "services", "table-formulas.ts"), "utf8");
  const names = /\(\?<op>([a-z|]+)\)/.exec(text)?.[1];
  return names ? names.split("|") : [];
}

/**
 * Whether the page names this, as a whole word inside a code span:
 * `strip` and `layout: strip` count, `strips` does not.
 */
function mentions(name: string): boolean {
  const word = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\`[^\`\n]*(?<![\\w-])${word}(?![\\w-])[^\`\n]*\``).test(sheet);
}

describe("the cheatsheet", () => {
  it(`stays within ${MAX_CHEATSHEET_LINES} lines`, () => {
    expect(sheet.trimEnd().split("\n").length).toBeLessThanOrEqual(MAX_CHEATSHEET_LINES);
  });

  it("says which version it was checked against", () => {
    expect(sheet).toMatch(/^Checked against Schreibstube \d+\.\d+\.\d+$/m);
  });

  it("names every frontmatter key the plugin reads or writes", () => {
    const missing = [...keysInCode()].filter((key) => !mentions(key));
    expect(missing).toEqual([]);
  });

  it("names no schreibstube key the plugin does not know", () => {
    const known = keysInCode();
    // A key on the page that the code never spells is one a model will write
    // for nothing. The mistakes section names two on purpose, as mistakes.
    const invented = new Set(["schreibstubeTheme", "schreibstubeFooter"]);
    const onPage = [...sheet.matchAll(/schreibstube[A-Z][A-Za-z]*/g)].map((match) => match[0]);
    expect(onPage.filter((key) => !known.has(key) && !invented.has(key))).toEqual([]);
  });

  it("names every slide setting, layout, format and alignment", () => {
    for (const directive of SLIDE_DIRECTIVES) expect(sheet).toContain(`<!-- ${directive}`);
    for (const layout of REQUESTED_LAYOUTS)
      expect(mentions(layout) || sheet.includes(`layout: ${layout}`)).toBe(true);
    for (const format of SLIDE_FORMATS) expect(sheet).toContain(`"${format}"`);
    for (const align of SLIDE_ALIGNS) expect(mentions(align)).toBe(true);
  });

  it("names every slideshow layout, formula, block and built-in template", () => {
    for (const layout of SLIDESHOW_LAYOUTS) expect(mentions(layout)).toBe(true);
    for (const formula of formulasInCode()) expect(sheet).toContain(`=${formula}`);
    expect(formulasInCode().length).toBeGreaterThan(0);
    for (const language of [SLIDESHOW_LANGUAGE, TASK_SUMMARY_LANGUAGE]) {
      expect(sheet).toContain(`\`\`\`${language}`);
    }
    for (const template of EXAMPLE_TEMPLATES) expect(mentions(template.name)).toBe(true);
  });
});
