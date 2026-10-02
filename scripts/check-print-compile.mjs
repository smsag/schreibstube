/**
 * Compile every print fixture with the typesetter the plugin runs.
 *
 * The converter's tests compare strings, and Typst is the only judge of
 * whether a string is Typst: every callout once failed to print while its test
 * passed. This builds the jobs in `src/testing/print-fixtures.ts` — every case,
 * for every example template and two made here — with the modules a print
 * uses, and runs them through the worker's own source on the pinned runtime.
 *
 * A job fails when the compiler refuses it, or when the note has text and the
 * PDF carries no font to draw it with: the typesetter has no typeface of its
 * own, and a page set without one is blank — which is what every template
 * without a font of its own printed until the standard fonts were pinned.
 *
 * Every page job is set a second time with its blocks marked, as the print
 * dialog sets its preview, and fails unless that is the very same PDF, but for
 * the moment it was made, and reports where each block starts: the dialog
 * writes the preview's document, so a mark that moved a single line would
 * print a page nobody chose.
 *
 *   node scripts/fetch-typst-runtime.mjs   # once: the pinned runtime, into dist/
 *   node scripts/check-print-compile.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { parse } from "yaml";

// Above the code that runs: the top level executes as the module loads, and a
// class, unlike a function, does not exist until its line has. Declared below
// the `try`, the catch's `instanceof Failure` throws and buries the message.
class Failure extends Error {}

/** Thrown, not exited: `process.exit` would skip the `finally` that removes the work directory. */
function fail(message) {
  throw new Failure(message);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "print-compile-"));

try {
  const harness = await load();
  harness.setLanguage("en");

  const runtime = readRuntime(harness.DEVICE_ASSETS);
  const compile = await startWorker(harness.WORKER_SOURCE, runtime);

  const templates = [...exampleTemplates(), ...madeHere(harness.PIXEL_PNG)];
  const jobs = harness.fixtureJobs(templates);
  const failures = [];

  for (const { name, job, hasText, deck, marked } of jobs) {
    const reply = await compile(harness.compilePayload(job), harness.compileDeadline(job));
    if (reply === null) {
      failures.push(`${name}: the compiler gave no answer within its deadline`);
    } else if (!reply.ok) {
      failures.push(`${name}: the worker failed — ${reply.error}`);
    } else if (!reply.pdf) {
      failures.push(
        `${name}: ${harness.describeDiagnostics((reply.diagnostics ?? []).map(String))}`
      );
    } else if (hasText && !embedsFont(reply.pdf)) {
      failures.push(
        `${name}: the PDF has text to set and no font to set it in, so its pages are blank`
      );
    } else if (deck && name.endsWith("/slides") && harness.readSlideFits(reply.fits).length === 0) {
      // The case holds a slide that only fits made smaller; a deck that
      // reports no fit means the warning about small slides can never come.
      failures.push(`${name}: the overfull slide was not reported by the compile`);
    } else if (marked) {
      const twin = await compile(harness.compilePayload(marked), harness.compileDeadline(marked));
      if (!twin?.pdf) {
        failures.push(`${name}: marked for the dialog, it did not compile`);
      } else if (timeless(twin.pdf) !== timeless(reply.pdf)) {
        failures.push(`${name}: the dialog's block marks changed the document`);
      } else if (hasText && harness.readBlockPositions(twin.blocks).length === 0) {
        failures.push(`${name}: marked for the dialog, it reported no block positions`);
      }
    }
  }

  const total = `${jobs.length} jobs from ${templates.length} templates`;
  if (failures.length > 0) {
    console.error(`${failures.length} of ${total} failed:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`${total} compiled with the pinned runtime.`);
  }
} catch (error) {
  console.error(error instanceof Failure ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}

/**
 * A PDF with the moment it was made taken out. Typst stamps the time into the
 * info dictionary and the XMP and derives the document's identifier from it,
 * so two compiles of one job either side of a second differ there and nowhere
 * else — about one job in fifty, which is how this was found.
 */
function timeless(pdf) {
  return Buffer.from(pdf)
    .toString("latin1")
    .replace(/D:\d{14}Z/g, "D:")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, "")
    .replace(/\/ID\s*\[[^\]]*\]/g, "/ID []")
    .replace(/(xmpMM:(?:InstanceID|DocumentID)>)[^<]*</g, "$1<");
}

/** The fixtures and the plugin's own modules, bundled once from TypeScript. */
async function load() {
  const outfile = join(work, "harness.mjs");
  await esbuild.build({
    stdin: {
      contents: [
        'export { fixtureJobs, PIXEL_PNG } from "./src/testing/print-fixtures";',
        'export { compileDeadline, compilePayload } from "./src/services/print-job";',
        'export { readSlideFits } from "./src/services/print-slides";',
        'export { readBlockPositions } from "./src/services/print-breaks";',
        'export { describeDiagnostics, DEVICE_ASSETS } from "./src/services/typst-runtime";',
        'export { WORKER_SOURCE } from "./src/print/typst-worker";',
        'export { setLanguage } from "./src/i18n";'
      ].join("\n"),
      resolveDir: root,
      loader: "ts"
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    logLevel: "warning"
  });
  return import(pathToFileURL(outfile).href);
}

/** The runtime and its fonts from dist/, held to the hashes the plugin holds them to. */
function readRuntime(assets) {
  const bytes = { fonts: [] };
  for (const asset of assets) {
    const path = join(root, "dist", asset.name);
    if (!existsSync(path)) {
      fail(`${asset.name} is not in dist/. Run: node scripts/fetch-typst-runtime.mjs`);
    }
    const content = readFileSync(path);
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== asset.sha256) fail(`${asset.name} in dist/ is not the pinned runtime`);
    if (asset.label === "font") bytes.fonts.push(new Uint8Array(content));
    else bytes[asset.label] = content;
  }
  return bytes;
}

/**
 * The worker's own source, run in this process.
 *
 * It is the code a device runs, so it is run rather than restated: `self` is
 * a message port of one, and the blob URL it imports the loader from is a data
 * URL, which is the one kind Node can import from text.
 */
async function startWorker(source, runtime) {
  const replies = new Map();
  const self = {
    onmessage: null,
    postMessage: (message) => {
      replies.get(message.id)?.(message);
      replies.delete(message.id);
    }
  };
  const url = {
    createObjectURL: (blob) =>
      `data:text/javascript;base64,${Buffer.from(blob.parts.join("")).toString("base64")}`,
    revokeObjectURL: () => {}
  };
  class TextBlob {
    constructor(parts) {
      this.parts = parts;
    }
  }
  new Function("self", "URL", "Blob", source)(self, url, TextBlob);

  let nextId = 1;
  const send = (kind, payload) =>
    new Promise((resolve) => {
      const id = nextId++;
      replies.set(id, resolve);
      self.onmessage({ data: { id, kind, payload } });
    });

  const module = await WebAssembly.compile(runtime.compiler);
  const ready = await send("init", {
    module,
    loader: runtime.loader.toString("utf8"),
    fonts: runtime.fonts
  });
  if (!ready.ok) fail(`the runtime did not start: ${ready.error}`);

  // Raced rather than awaited: a layout that loops would otherwise hold the
  // CI job for the hours a runner allows, and name no fixture.
  return (payload, deadlineMs) =>
    Promise.race([
      send("compile", payload),
      new Promise((resolve) => setTimeout(() => resolve(null), deadlineMs).unref())
    ]);
}

/** The templates the plugin carries, read from their folders as a vault holds them. */
function exampleTemplates() {
  const base = join(root, "examples/print");
  return readdirSync(base)
    .filter((name) => statSync(join(base, name)).isDirectory())
    .map((name) => {
      const folder = join(base, name);
      const descriptor = readFileSync(join(folder, "template.md"), "utf8");
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(descriptor);
      if (!frontmatter) fail(`examples/print/${name}/template.md has no frontmatter`);
      return {
        folder: `Vorlagen/Druck/${name}`,
        frontmatter: parse(frontmatter[1]),
        layout: readFileSync(join(folder, "template.typ"), "utf8"),
        fonts: readFonts(join(folder, "fonts"))
      };
    });
}

/**
 * Three templates no folder holds: one with no opinions, so the prelude's
 * defaults are what is compiled; one that replaces every helper, so a
 * template's own definitions are shown to be the ones that are called; and a
 * deck with no opinions, so the prelude's own slide is compiled for every case.
 * Beside them the Folien example with its brand filled in — a colour, a face
 * and a logo — which its folder leaves empty.
 */
function madeHere(pixel) {
  const entry = "#let template(body, data) = body\n";
  const own = [
    "#let schreibstube-image(path, alt) = image(path, width: 2cm)",
    "#let schreibstube-diagram(paths, caption) = for path in paths { image(path, width: 2cm) }",
    "#let schreibstube-code(source, language) = raw(source, block: true)",
    "#let schreibstube-table(columns: 1, align: (left,), ..cells) = table(columns: columns, ..cells)",
    "#let schreibstube-callout(kind, title, body) = block(stroke: red)[#title #body]",
    "#let schreibstube-task(done) = if done [(x)] else [( )]"
  ].join("\n");
  const folien = exampleTemplates().find((template) => template.folder.endsWith("/folien"));
  if (!folien) fail("examples/print/folien is missing");
  const branded = {
    ...folien,
    folder: "Vorlagen/Druck/Folien mit Marke",
    frontmatter: {
      ...folien.frontmatter,
      schreibstubeData: { accent: "#8c1a33", font: "JetBrains Mono", logo: "logo.png" }
    },
    assets: [{ path: "logo.png", bytes: pixel }]
  };
  return [
    branded,
    { folder: "Vorlagen/Druck/Ohne Meinung", frontmatter: {}, layout: entry },
    { folder: "Vorlagen/Druck/Eigene Helfer", frontmatter: {}, layout: `${own}\n${entry}` },
    {
      folder: "Vorlagen/Druck/Folien ohne Meinung",
      frontmatter: { schreibstubeSlides: true },
      layout: entry
    }
  ];
}

function readFonts(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => /\.(ttf|otf|ttc|otc)$/i.test(name))
    .map((name) => ({
      path: `fonts/${name}`,
      bytes: new Uint8Array(readFileSync(join(folder, name)))
    }));
}

/** Typst embeds every face it sets text in; a PDF with none has drawn no text. */
function embedsFont(pdf) {
  return /\/FontFile[23]?\b/.test(Buffer.from(pdf).toString("latin1"));
}
