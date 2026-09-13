/**
 * Two properties of the bundle that are easy to break with one import and
 * invisible until someone opens the vault on a phone.
 *
 * The plugin must keep running on mobile, where Obsidian has no Node runtime.
 * That holds only while nothing pulls a Node built-in into the bundle.
 *
 * And the bundle must stay small: Obsidian parses main.js on every start, so
 * its size is paid by every user every day. The budget is a ceiling, not a
 * target; raise it deliberately, in the same change that explains why.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The bundle was 277 KB when the budget was set. */
const MAX_BUNDLE_KB = 400;

const bundle = fileURLToPath(new URL("../main.js", import.meta.url));
const source = readFileSync(bundle, "utf8");

const builtins = [...source.matchAll(/["'`](node:[a-z/]+)["'`]/g)].map((match) => match[1]);
const unique = [...new Set(builtins)];

if (unique.length > 0) {
  console.error(
    `main.js reaches for Node built-ins: ${unique.join(", ")}.\n` +
      "The plugin would stop loading on mobile. Move that code to the bridge."
  );
  process.exit(1);
}

const kb = source.length / 1024;
if (kb > MAX_BUNDLE_KB) {
  console.error(
    `main.js is ${kb.toFixed(0)} KB, over the ${MAX_BUNDLE_KB} KB budget.\n` +
      "Check for an inlined source map or a dependency that should not be bundled."
  );
  process.exit(1);
}

console.log(`main.js is free of Node built-ins and within budget (${kb.toFixed(0)} KB).`);
