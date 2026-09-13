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

const ROOT = "examples/print";
const OUT = "src/services/print-examples.ts";

/** The files a template is made of, in the order a reader meets them. */
const FILES = ["template.md", "template.typ"];

const folders = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const entries = folders.map((folder) => {
  const files = FILES.map((name) => ({
    name,
    text: readFileSync(join(ROOT, folder, name), "utf8")
  }));
  const name = folder.charAt(0).toUpperCase() + folder.slice(1);
  return { folder, name, files };
});

const body = entries
  .map(
    (entry) => `  {
    name: ${JSON.stringify(entry.name)},
    source: ${JSON.stringify(`${ROOT}/${entry.folder}`)},
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
 * redistribute one, and a template with no font still prints: Typst sets it in
 * its own. The descriptor says so in the prose a person reads after adding it.
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
