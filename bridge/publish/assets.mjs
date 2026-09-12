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
import { THEME_CSS } from "./render/page.mjs";

const require = createRequire(import.meta.url);
const cache = new Map();

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
  return cached("mermaid", () => readFile(`${distDirectory("mermaid/package.json")}/mermaid.min.js`));
}

function distDirectory(manifestPath) {
  return require.resolve(manifestPath).replace(/package\.json$/, "dist");
}

async function cached(key, load) {
  if (!cache.has(key)) cache.set(key, await load());
  return cache.get(key);
}
