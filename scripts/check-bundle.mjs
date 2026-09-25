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

/**
 * The bundle was 277 KB when the budget was set at 400 KB.
 *
 * Raised to 420 KB at 391 KB, ahead of the slideshow layouts (+5 KB) and the
 * property icons and dates (+8 KB): each fitted under 400 alone, together
 * they come to about 404.
 *
 * Raised to 440 KB at 420 KB, on the slideshow's before/after slider (+2 KB).
 * That ceiling was met to within four bytes, which is not a budget but a
 * build that breaks on the next line anyone writes; the slider is measured
 * and small, and what it revealed is that the headroom was already spent.
 * The headroom left is for the next feature, not a new normal — a change
 * that needs more says why, as this one does.
 *
 * Raised to 460 KB at 438 KB, for the PDF summary (+7 KB): the reader that
 * borrows Obsidian's pdf.js, the rules that cut a text layer into passages,
 * the modal that offers them, and every string of it in two languages. It is
 * a small feature because the expensive part is not ours — pdf.js is larger
 * than this whole plugin, and is borrowed rather than shipped. The headroom
 * left is for the next feature, not a new normal.
 *
 * The file pane's selection, undo and import (+11 KB) fit under that
 * ceiling, at 454 KB: three operations a file manager is expected to have,
 * none of them borrowed. What is left is for the next feature.
 *
 * Raised to 480 KB at 459 KB, for icons in the text (+4 KB): the scanner
 * that finds `:folder:` outside code and links, the picker that opens on a
 * colon, the widget and the post-processor that draw the glyph, and the
 * setting in two languages. Small, because the icons and their names were
 * in the bundle already; what it spent was the last kilobyte of headroom,
 * and one kilobyte is a build that breaks on the next line anyone writes.
 * The headroom left is for the next feature, not a new normal.
 *
 * Raised to 490 KB at 477 KB, for printing that works (+6 KB): callouts, a
 * template's own helpers, code before a bracket and diagrams inside a callout
 * all failed to print, and the fixes brought what a print needs to be safe —
 * no silent overwrite of somebody's PDF, deadlines on other plugins' drawing,
 * budgets before a read — and its warnings and refusals in both languages,
 * which are most of the six. Trimming to fit would have meant leaving those
 * in English again. The headroom left is for the next feature.
 *
 * Raised to 500 KB at 486 KB, for printing without a template of one's own
 * (+6 KB): the built-in Standard, carried as the text of its layout and of the
 * descriptor a person reads when they lay it down to change it, its parsed
 * frontmatter so no YAML parser ships, the default-template setting and its
 * words in two languages. Trimming the descriptor to fit would have cut the
 * instructions a template author reads first. What is left is for the next
 * feature.
 *
 * Raised to 510 KB at 506 KB, for the print dialog and slideshows on paper
 * (+14 KB since 492): the dialog with its preview drawn by Obsidian's pdf.js,
 * the choices it offers and what each means, the note's properties on paper,
 * and every slideshow layout as the Typst that arranges it — the arrangement
 * code ships as text in the prelude, which is most of the growth — each in two
 * languages. The dialog was built at 499 KB, one kilobyte short; this is the
 * decision that was deferred then, taken once for both.
 */
const MAX_BUNDLE_KB = 510;

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
