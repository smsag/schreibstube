/**
 * Put the example templates inside the plugin, so a template can be added
 * without leaving the app.
 *
 * The folders under `examples/print/` are the source of truth: they are what a
 * person reads on the repository and what the documentation points at. This
 * copies them into a module the bundle carries, because a phone cannot fetch a
 * folder from a web page and drop it into a vault.
 *
 * Run it after changing an example. `print-examples.test.ts` compares the two
 * and fails when they have drifted, so nobody has to remember.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";

const ROOT = "examples/print";
const OUT = "src/services/print-examples.ts";

/** What a template must have, whatever else it carries. */
const REQUIRED = ["template.md", "template.typ"];

/** What can be carried as text. A font or a logo is neither, and is skipped. */
const TEXT = /\.(md|typ|txt|json|ya?ml|csv)$/i;

const folders = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const entries = folders.map((folder) => {
  // Read from the folder rather than from a list written here: an example that
  // grows a third file should arrive by being added, not by somebody
  // remembering to edit this script, and the test that compares the two would
  // not notice a file that was never read in the first place.
  const present = readdirSync(join(ROOT, folder), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  for (const required of REQUIRED) {
    if (!present.includes(required)) {
      throw new Error(`${ROOT}/${folder} has no ${required}, so it is not a template`);
    }
  }

  const skipped = present.filter((name) => !TEXT.test(name));
  if (skipped.length > 0) {
    console.warn(`${ROOT}/${folder}: not carried, because it is not text: ${skipped.join(", ")}`);
  }

  // Required first, in the order a reader meets them, then the rest.
  const ordered = [...REQUIRED, ...present.filter((name) => !REQUIRED.includes(name))];
  const files = ordered
    .filter((name) => TEXT.test(name))
    .map((name) => ({ name, text: readFileSync(join(ROOT, folder, name), "utf8") }));

  const name = folder.charAt(0).toUpperCase() + folder.slice(1);

  // Parsed here, once, so that the plugin can use a carried template — the
  // built-in one prints without being in the vault — without a YAML parser of
  // its own. Obsidian parses the copy a person lays down; this is what it
  // would read.
  const descriptor = files.find((file) => file.name === "template.md")?.text ?? "";
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(descriptor);
  if (!match) throw new Error(`${ROOT}/${folder}/template.md has no frontmatter`);
  const frontmatter = parse(match[1]);

  return { folder, name, files, frontmatter };
});

const body = entries
  .map(
    (entry) => `  {
    name: ${JSON.stringify(entry.name)},
    source: ${JSON.stringify(`${ROOT}/${entry.folder}`)},
    frontmatter: ${JSON.stringify(entry.frontmatter)},
    files: [
${entry.files
  .map((file) => `      { name: ${JSON.stringify(file.name)}, text: ${JSON.stringify(file.text)} }`)
  .join(",\n")}
    ]
  }`
  )
  .join(",\n");

const module = `/**
 * The templates the plugin can lay down in a vault.
 *
 * Generated from \`${ROOT}/\` by \`scripts/build-print-examples.mjs\`; edit the
 * folders there, not this file. A template is three or four small text files,
 * so carrying them costs a few kilobytes and saves a person leaving the app to
 * find a folder on a web page — which on a phone is not really possible at all.
 *
 * Fonts are not carried. A typeface is licensed, a repository is no place to
 * redistribute one, and a template with no font still prints: it is set in the
 * standard fonts the plugin fetches with the typesetter. The descriptor says so
 * in the prose a person reads after adding it.
 */

export interface ExampleFile {
  name: string;
  text: string;
}

export interface ExampleTemplate {
  /** The folder name it is written as, and the name a note asks for. */
  name: string;
  /** Where it came from, for the documentation to agree with the code. */
  source: string;
  /** The descriptor's frontmatter, parsed at build time as Obsidian would. */
  frontmatter: Record<string, unknown>;
  files: ExampleFile[];
}

export const EXAMPLE_TEMPLATES: readonly ExampleTemplate[] = [
${body}
];
`;

writeFileSync(OUT, module);

// Formatted here rather than left for somebody to notice: the check runs
// prettier over everything, and a generator whose output fails it turns every
// regeneration into a second step nobody remembers.
execFileSync("npx", ["prettier", "--write", OUT], { stdio: "ignore" });
console.log(`${OUT}: ${entries.length} templates, ${module.length} bytes`);
