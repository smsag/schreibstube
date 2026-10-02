/**
 * Turn the curated icon list into a module the bundle can carry.
 *
 * Obsidian installs three files from a release — `main.js`, `manifest.json`,
 * `styles.css` — and nothing else. A `.woff2` next to them would never reach a
 * user, so the font has to travel inside one of the three. It travels inside
 * the bundle, base64-encoded, which makes subsetting the difference between a
 * plugin that loads and one that ships half a megabyte of glyphs nobody picked.
 *
 * Input:  @tabler/icons-webfont and @tabler/icons, installed on demand rather
 *         than depended on, and our own artwork for what Tabler lacks
 *         (CUSTOM_ICONS)
 * Output: src/ui/icon-font.generated.ts, and for the website
 *         bridge/publish/render/icons.generated.mjs
 *
 * Run it with `npm run build:icons` after editing `scripts/icon-set.mjs`. The
 * generated files are committed, so a normal build needs neither the Tabler
 * packages nor Python.
 *
 * Our own glyphs are outlined from their SVG sources and merged into the
 * subset by `add-icon-glyphs.py`, after Tabler's are cut, so the one font
 * carries both and nothing that draws an icon has to know which is which.
 *
 * The website cannot borrow the font: it is a plugin's, inside a bundle. It
 * draws the same names as inline SVG instead, from the same release's stroke
 * drawings and the same artwork, and one run writes both so a name the picker
 * offers is never one the site leaves as text.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { artworkNodes, inlineMarkup, planIconFont } from "./icon-plan.mjs";
import { CUSTOM_ICONS, ICON_GROUPS, UI_ICONS } from "./icon-set.mjs";

const packageDir = fileURLToPath(new URL("../node_modules/@tabler/icons-webfont", import.meta.url));
const svgPackageDir = fileURLToPath(new URL("../node_modules/@tabler/icons", import.meta.url));
const output = fileURLToPath(new URL("../src/ui/icon-font.generated.ts", import.meta.url));
const bridgeOutput = fileURLToPath(
  new URL("../bridge/publish/render/icons.generated.mjs", import.meta.url)
);
const root = fileURLToPath(new URL("..", import.meta.url));
const addGlyphs = fileURLToPath(new URL("./add-icon-glyphs.py", import.meta.url));

if (!existsSync(packageDir) || !existsSync(svgPackageDir)) {
  fail(
    "The Tabler webfont and SVG set are not installed.\n" +
      "They are not dependencies — they weigh more than the rest of the tree and the generated\n" +
      "files are committed, so they are fetched only when the icon set actually changes.\n" +
      "Both from the same release, the one named in src/ui/icon-font.generated.ts:\n\n" +
      "  npm install --no-save @tabler/icons-webfont@<version> @tabler/icons@<version>\n" +
      "  pip install fonttools brotli picosvg"
  );
}

const version = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
const svgVersion = JSON.parse(readFileSync(join(svgPackageDir, "package.json"), "utf8")).version;
if (svgVersion !== version) {
  fail(
    `The Tabler webfont is ${version} and the SVG set ${svgVersion}.\n` +
      "The site would draw a different icon from the one picked; install both at one version."
  );
}
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

/** Every shipped name to the shapes the website draws it with. */
const strokes = JSON.parse(readFileSync(join(svgPackageDir, "tabler-nodes-outline.json"), "utf8"));
const inlineOf = new Map();
try {
  for (const name of plan.tabler) {
    // The webfont also carries names the SVG set has since renamed; a name
    // drawn in Obsidian and left as text on the site would be the bug this
    // file exists to prevent.
    if (!strokes[name]) fail(`Tabler's SVG set has no "${name}", which its webfont has.`);
    inlineOf.set(name, inlineMarkup(name, strokes[name]));
  }
  for (const icon of plan.custom) {
    const source = readFileSync(join(root, icon.source), "utf8");
    inlineOf.set(icon.name, inlineMarkup(icon.name, artworkNodes(icon.name, source)));
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

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
  // `fail` exits, and an exit skips the `finally` below.
  rmSync(work, { recursive: true, force: true });
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

const drawings = wanted
  .map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(inlineOf.get(name))}`)
  .join(",\n");

writeFileSync(
  bridgeOutput,
  `/* GENERATED by scripts/build-icon-font.mjs — do not edit.
 * Source: Tabler Icons ${version} (MIT), the outline drawings of the names in
 * scripts/icon-set.mjs, plus our own from: ${plan.custom.map((icon) => icon.source).join(", ") || "none"}.
 * Regenerate with: npm run build:icons
 */

/** Which Tabler release the drawings came from. */
export const ICON_VERSION = "${version}";

/** Icon name to the shapes inside its 24-unit SVG: the names the plugin's font draws. */
export const ICON_SHAPES = {
${drawings}
};
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
    `${(base64.length / 1024).toFixed(1)} KB base64 (full font is ${(full / 1024).toFixed(0)} KB); ` +
    `the website's drawings ${(Buffer.byteLength(drawings) / 1024).toFixed(1)} KB.`
);

function fail(message) {
  console.error(message);
  process.exit(1);
}
