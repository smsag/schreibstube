/**
 * Turn the curated icon list into a module the bundle can carry.
 *
 * Obsidian installs three files from a release — `main.js`, `manifest.json`,
 * `styles.css` — and nothing else. A `.woff2` next to them would never reach a
 * user, so the font has to travel inside one of the three. It travels inside
 * the bundle, base64-encoded, which makes subsetting the difference between a
 * plugin that loads and one that ships half a megabyte of glyphs nobody picked.
 *
 * Input:  @tabler/icons-webfont, installed on demand rather than depended on,
 *         and our own artwork for what Tabler lacks (CUSTOM_ICONS)
 * Output: src/ui/icon-font.generated.ts
 *
 * Run it with `npm run build:icons` after editing `scripts/icon-set.mjs`. The
 * generated file is committed, so a normal build needs neither the font package
 * nor Python.
 *
 * Our own glyphs are outlined from their SVG sources and merged into the
 * subset by `add-icon-glyphs.py`, after Tabler's are cut, so the one font
 * carries both and nothing that draws an icon has to know which is which.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planIconFont } from "./icon-plan.mjs";
import { CUSTOM_ICONS, ICON_GROUPS, UI_ICONS } from "./icon-set.mjs";

const packageDir = fileURLToPath(new URL("../node_modules/@tabler/icons-webfont", import.meta.url));
const output = fileURLToPath(new URL("../src/ui/icon-font.generated.ts", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));
const addGlyphs = fileURLToPath(new URL("./add-icon-glyphs.py", import.meta.url));

if (!existsSync(packageDir)) {
  fail(
    "The Tabler webfont is not installed.\n" +
      "It is not a dependency — it weighs more than the rest of the tree and the generated\n" +
      "file is committed, so it is fetched only when the icon set actually changes:\n\n" +
      "  npm install --no-save @tabler/icons-webfont\n" +
      "  pip install fonttools brotli picosvg"
  );
}

const version = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
const css = readFileSync(join(packageDir, "dist/tabler-icons.css"), "utf8");

/** Every `.ti-name:before { content: "\eaad" }` rule, as name → codepoint. */
const available = new Map();
for (const match of css.matchAll(/\.ti-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)"/g)) {
  available.set(match[1], Number.parseInt(match[2], 16));
}

if (available.size === 0) {
  fail("Could not read any codepoints from the Tabler stylesheet. Did its format change?");
}

const wanted = [...new Set([...UI_ICONS, ...ICON_GROUPS.flatMap((group) => group.icons)])].sort();
const plan = planIconFont(wanted, available, CUSTOM_ICONS);
if (plan.errors.length > 0) fail(plan.errors.join("\n"));

const missing = plan.custom.filter((icon) => !existsSync(join(root, icon.source)));
if (missing.length > 0) {
  fail(`Missing artwork for our own icons: ${missing.map((icon) => icon.source).join(", ")}.`);
}

/** Every shipped name to its codepoint, Tabler's and ours alike. */
const codepointOf = new Map([
  ...plan.tabler.map((name) => [name, available.get(name)]),
  ...plan.custom.map((icon) => [icon.name, icon.codepoint])
]);

const duplicates = ICON_GROUPS.flatMap((group) => group.icons).filter(
  (name, index, all) => all.indexOf(name) !== index
);

const work = mkdtempSync(join(tmpdir(), "schreibstube-icons-"));
let subset;
try {
  const cut = join(work, "subset.woff2");
  const target = join(work, "merged.woff2");
  const unicodes = plan.tabler.map((name) => `U+${available.get(name).toString(16)}`).join(",");

  execFileSync(
    "pyftsubset",
    [
      join(packageDir, "dist/fonts/tabler-icons.woff2"),
      `--unicodes=${unicodes}`,
      "--flavor=woff2",
      "--layout-features=",
      "--no-hinting",
      "--desubroutinize",
      `--output-file=${cut}`
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );

  if (plan.custom.length > 0) {
    execFileSync(
      "python3",
      [
        addGlyphs,
        cut,
        target,
        ...plan.custom.flatMap((icon) => [
          icon.name,
          icon.codepoint.toString(16),
          join(root, icon.source)
        ])
      ],
      { stdio: ["ignore", "ignore", "inherit"] }
    );
  } else {
    renameSync(cut, target);
  }

  subset = readFileSync(target);
} catch (error) {
  fail(
    `Subsetting failed: ${error instanceof Error ? error.message : String(error)}\n` +
      "This script needs fonttools with woff2 support, and picosvg to outline our own\n" +
      "artwork: pip install fonttools brotli picosvg"
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

const base64 = subset.toString("base64");
const full = readFileSync(join(packageDir, "dist/fonts/tabler-icons.woff2")).length;

const codepoints = wanted
  // The braced form: Tabler has outgrown the Basic Multilingual Plane, and a
  // codepoint above U+FFFF written as four digits and a leftover is a wrong
  // glyph followed by a stray character — "tag" was U+10096, and drew as
  // U+1009 and a 6.
  .map((name) => `  "${name}": "\\u{${codepointOf.get(name).toString(16)}}"`)
  .join(",\n");

const groups = ICON_GROUPS.map(
  (group) =>
    `  {\n    id: "${group.id}",\n    icons: [${group.icons.map((icon) => `"${icon}"`).join(", ")}]\n  }`
).join(",\n");

writeFileSync(
  output,
  `/* GENERATED by scripts/build-icon-font.mjs — do not edit.
 * Source: Tabler Icons ${version} (MIT), subset to the names in scripts/icon-set.mjs,
 * plus our own glyphs from: ${plan.custom.map((icon) => icon.source).join(", ") || "none"}.
 * Regenerate with: npm run build:icons
 */

/** The subset, base64-encoded, injected as a data URL at load. */
export const ICON_FONT_WOFF2 = "${base64}";

/** Which Tabler release the subset came from, for the settings tab. */
export const ICON_FONT_VERSION = "${version}";

/** Icon name to the private-use character that draws it. */
export const ICON_CODEPOINTS: Record<string, string> = {
${codepoints}
};

/** The picker's groups, in display order. */
export const ICON_GROUPS: { id: string; icons: string[] }[] = [
${groups}
];
`,
  "utf8"
);

if (duplicates.length > 0) {
  console.warn(
    `Note: these icons appear in more than one group: ${[...new Set(duplicates)].join(", ")}`
  );
}

console.log(
  `Wrote ${wanted.length} icons: ${(subset.length / 1024).toFixed(1)} KB woff2, ` +
    `${(base64.length / 1024).toFixed(1)} KB base64 (full font is ${(full / 1024).toFixed(0)} KB).`
);

function fail(message) {
  console.error(message);
  process.exit(1);
}
