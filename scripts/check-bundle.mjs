/**
 * Three properties of the bundle that are easy to break with one import and
 * invisible until someone opens the vault on a phone, or reads what it loads.
 *
 * The plugin must keep running on mobile, where Obsidian has no Node runtime.
 * That holds only while nothing pulls a Node built-in into the bundle.
 *
 * It must run only what the release attests: no code fetched from a CDN.
 *
 * And the bundle must stay small: Obsidian parses main.js on every start, so
 * its size is paid by every user every day. The budget is a ceiling, not a
 * target; raise it deliberately, in the same change that explains why.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CODE_CDNS } from "./embedding-bundle.mjs";

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
 *
 * Raised to 525 KB at 518 KB, for picture descriptions (+9 KB on 509): the
 * instruction a vision model is sent, the check an answer must pass before a
 * word of it is written — every bound, and the stripping of links, tags,
 * fences and HTML — the note it becomes, the settings that switch it on and
 * where it writes, all in two languages. The semantic engine that will index
 * these notes is not in this number; it brings its own raise and its reason.
 *
 * Raised to 1450 KB at 1420 KB, for search by meaning (+898 KB on 522). Nearly
 * all of it is the model runtime — the tokenizer and the ONNX glue from
 * transformers.js, about 870 KB — carried as one string and started in a
 * worker or a frame only when the setting is on. It ships inside main.js
 * because a BRAT install is three files; a fourth would not arrive. A string
 * literal is scanned at start, not compiled, so the cost every user pays daily
 * is the read, not the parse this budget was set against. The engine itself —
 * index, journal, watcher, fusion and settings in two languages — is the
 * remaining ~30 KB. The model weights are not in this number: they download
 * on first use. What is left is for the next feature, not a new normal.
 *
 * Raised to 1470 KB at 1453 KB, for property sets (+15 KB on 1438): the sets
 * Schreibstube's own features need, built from the keys they read; a folder
 * of set notes, Templater templates among them, read and validated before a
 * key is written; four ways in — the property menu, a control beside "Add
 * property", Mail finding its keys missing and a key just typed that belongs
 * to a set — and every notice of it in two languages. The controller is
 * 7 KB, the decisions 3, the words 4. Leaving a way in out to fit would have
 * cut one of the four the feature was asked for. What is left is for the next
 * feature, not a new normal.
 *
 * Raised to 1490 KB at 1480 KB, for finding notes by their text, a faster
 * index and the numbers that show it (+19 KB on 1461): the vocabulary index
 * of every note's words and the loader that fills it, the reading of a note
 * as prose that both searches share, passages cut at words and merged when
 * short, a build that answers while it runs and remembers a note that failed,
 * a phone that holds the desktop's index and keeps its own edits in a journal
 * of its own, and the report in the settings — coverage, files, model, pace
 * and time left — with every word of it in two languages, which is half the
 * growth. The shared vocabulary is the part that could not be smaller: a word
 * list per note would have cost memory on a phone instead of bytes here.
 * What is left is for the next feature, not a new normal.
 *
 * Raised to 1500 KB at 1490 KB, for a send that carries what the note says
 * (+6 KB on 1489): the note read into plain text for the body, so a recipient
 * no longer gets asterisks, brackets and the comments Obsidian hides; the
 * draft read again at the press of Send and compared with the one shown; the
 * dialogue that redraws itself, warns about a missing To and shows the text;
 * and the unconfirmed send, told apart from a failed one — each notice in two
 * languages. Each fixes a mail that went out wrong; none was optional. The
 * comment stripping is the printer's, shared rather than written twice.
 *
 * Raised to 1520 KB at 1500 KB, for the mark "Show passage" leaves in the
 * editor (+1.5 KB on 1499): a tint over the passage, a bar beside its lines
 * and a point for an insertion, drawn as editor decorations that go at the
 * next edit or when their own timer runs out. The selection the button made
 * was drawn in an unfocused editor's grey, so a press scrolled the note and
 * said nothing about where to look. The feature is small; the budget had been
 * spent down to the kilobyte by the Recommended list before it. What is left
 * is for the next feature, not a new normal.
 *
 * Twice the picker's icons (+38 KB on 1364) fit under that ceiling, at 1402 KB:
 * 215 glyphs for what the set had nothing for — a chapter's number, a
 * character, a scene's weather, a draft's mood — carried as font, which costs
 * about 180 bytes a glyph. A set that grows again by as much spends a third of
 * what is left.
 */
const MAX_BUNDLE_KB = 1520;

/**
 * Whether the bundle was built from the tree the lockfile pins.
 *
 * The bundle holds whatever `node_modules` holds, and a worktree keeps the
 * `node_modules` it was made with while the lockfile moves on. Built from such
 * a tree, main.js measured 1527 KB against a budget it met at 1206 KB, and the
 * overrun was taken for the code's. A size measured from another tree says
 * nothing about this one, so it is not reported as one.
 */
function staleDependencies() {
  const root = new URL("../", import.meta.url);
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
  const stale = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith("node_modules/") || entry.link) continue;
    const pinned = pinnedVersion(path, entry);
    if (pinned === null) continue;
    const manifest = new URL(`${path}/package.json`, root);
    // Absent is not stale: an optional package for another platform, or a
    // dev tool the bundle never sees, is left out by npm itself.
    if (!existsSync(manifest)) continue;
    const installed = JSON.parse(readFileSync(manifest, "utf8")).version;
    if (installed !== pinned) {
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      stale.push(`${name} ${installed} (pinned ${pinned})`);
    }
  }
  return stale;
}

/**
 * The version `npm ci` installs for a lockfile entry.
 *
 * The tarball's, not the entry's `version`: the integrity hash pins the
 * tarball, and the two can disagree — the lockfile once carried hookified
 * as 1.16.0 resolved to the 1.15.1 tarball, and `npm ci` installs 1.15.1.
 */
function pinnedVersion(path, entry) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const tarball = entry.resolved?.split("/").pop() ?? "";
  const prefix = `${base}-`;
  if (tarball.startsWith(prefix) && tarball.endsWith(".tgz")) {
    return tarball.slice(prefix.length, -".tgz".length);
  }
  return entry.version ?? null;
}

const stale = staleDependencies();
if (stale.length > 0) {
  console.error(
    `main.js was built from dependencies other than the pinned ones:\n  ${stale.join("\n  ")}\n` +
      "Its size and contents would not be this code's. Run: npm ci"
  );
  process.exit(1);
}

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

/**
 * A CDN the bundle could load code from.
 *
 * Everything main.js runs is what the release attests, and the one thing it
 * fetches to run — the search runtime's WebAssembly — is pinned by hash. A CDN
 * address in the bundle is a path around both: the model runtime used to take
 * its JavaScript from jsDelivr and nothing checked it. Named anywhere, even in
 * a default nobody means to reach, it is refused.
 */
const cdns = CODE_CDNS.filter((host) => source.includes(host));
if (cdns.length > 0) {
  console.error(
    `main.js names ${cdns.join(", ")}, where it could load code nothing has checked.\n` +
      "Bundle the code, or pin and fetch it from the release; see scripts/embedding-bundle.mjs."
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

console.log(`main.js is free of Node built-ins and CDNs, and within budget (${kb.toFixed(0)} KB).`);
