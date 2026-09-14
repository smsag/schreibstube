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

/**
 * A Node built-in the bundle actually reaches for.
 *
 * Both spellings: esbuild writes the bare form for an un-prefixed import, so a
 * `require("fs")` used to pass a check that only looked for `node:`. And only
 * where a module is named — after `require(`, `import(` or `from` — because
 * `{ type: "module" }` on a Worker and a property called `url` are strings
 * that say nothing about what the bundle imports.
 */
const BARE_BUILTINS =
  "assert|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|" +
  "inspector|module|net|os|path|perf_hooks|process|querystring|readline|repl|stream|" +
  "string_decoder|tls|tty|url|util|v8|vm|worker_threads|zlib";
const MODULE_NAME = `(node:[a-z_/]+|(?:${BARE_BUILTINS})(?:/[a-z]+)?)`;
const BUILTIN_PATTERN = new RegExp(
  `(?:require\\(|import\\(|from)\\s*["'\`]${MODULE_NAME}["'\`]`,
  "g"
);

const builtins = [...source.matchAll(BUILTIN_PATTERN)].map((match) => match[1]);
const unique = [...new Set(builtins)];

if (unique.length > 0) {
  console.error(
    `main.js reaches for Node built-ins: ${unique.join(", ")}.\n` +
      "The plugin would stop loading on mobile. Move that code to the bridge."
  );
  process.exit(1);
}

// Bytes, not UTF-16 code units: the German catalogue and the typographic
// glyphs make the file larger on disk than its length suggests, so the budget
// was being compared against an under-count.
const kb = Buffer.byteLength(source, "utf8") / 1024;
if (kb > MAX_BUNDLE_KB) {
  console.error(
    `main.js is ${kb.toFixed(0)} KB, over the ${MAX_BUNDLE_KB} KB budget.\n` +
      "Check for an inlined source map or a dependency that should not be bundled."
  );
  process.exit(1);
}

console.log(`main.js is free of Node built-ins and within budget (${kb.toFixed(0)} KB).`);
