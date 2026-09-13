/**
 * Generator assets: the files the bridge writes that came from nobody's vault.
 *
 * They are read from the bridge's own dependencies rather than fetched, so a
 * published site never depends on a content delivery network and a rebuild
 * cannot silently pick up a different version of anything.
 *
 * They are loaded lazily and cached: a site with no maths never reads KaTeX off
 * disk, and a site with no diagrams never touches the five megabytes of Mermaid.
 */
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { THEME_CSS } from "./render/page.mjs";

const require = createRequire(import.meta.url);
const cache = new Map();

/**
 * Where the Mermaid bundle may be.
 *
 * The bridge copies one prebuilt file into a published site and never runs
 * Mermaid itself, but the package brings 167 MB of parser dependencies with
 * it. The image keeps the one file under `vendor/` and drops the rest, so that
 * location is looked in first; a checkout with the package installed, which is
 * what the tests run against, falls through to the package.
 */
const VENDORED_MERMAID = fileURLToPath(new URL("../vendor/mermaid.min.js", import.meta.url));

/**
 * The files a site needs, given what its pages turned out to use.
 *
 * `theme` is the stylesheet: the one from the publish folder when the vault
 * carries a `theme.css`, the built-in one otherwise.
 */
export async function generatorAssets({ math, mermaid, theme }) {
  const files = new Map();
  files.set("assets/theme.css", Buffer.from(theme ?? THEME_CSS, "utf8"));

  if (math) {
    for (const [path, content] of await katexAssets()) files.set(path, content);
  }
  if (mermaid) {
    files.set("assets/mermaid.min.js", await mermaidBundle());
  }
  return files;
}

async function katexAssets() {
  return cached("katex", async () => {
    const dist = distDirectory("katex/package.json");
    const files = [["assets/katex/katex.css", await readFile(`${dist}/katex.min.css`)]];

    // Only the woff2 faces are shipped. Every browser that can run a site built
    // this decade reads them, and copying the woff and ttf fallbacks as well
    // would triple the number of files for no reader anyone has.
    for (const name of await readdir(`${dist}/fonts`)) {
      if (!name.endsWith(".woff2")) continue;
      files.push([`assets/katex/fonts/${name}`, await readFile(`${dist}/fonts/${name}`)]);
    }
    return files;
  });
}

async function mermaidBundle() {
  return cached("mermaid", () =>
    firstReadable([
      VENDORED_MERMAID,
      () => `${distDirectory("mermaid/package.json")}/mermaid.min.js`
    ])
  );
}

/**
 * The first of the candidates that can be read. A candidate may be a function,
 * so that resolving a package that is not installed does not throw before an
 * earlier candidate has been tried.
 */
export async function firstReadable(candidates) {
  let lastError;
  for (const candidate of candidates) {
    try {
      return await readFile(typeof candidate === "function" ? candidate() : candidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`No readable candidate: ${lastError?.message ?? "none tried"}`);
}

function distDirectory(manifestPath) {
  return require.resolve(manifestPath).replace(/package\.json$/, "dist");
}

async function cached(key, load) {
  if (!cache.has(key)) cache.set(key, await load());
  return cache.get(key);
}
