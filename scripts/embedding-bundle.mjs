/**
 * How the model runtime that search by meaning starts is bundled, and why
 * nothing in it is fetched as code.
 *
 * transformers.js imports onnxruntime-web's WebGPU build and, at import, points
 * it at jsDelivr for the JavaScript that instantiates the WebAssembly module.
 * onnxruntime-web then imports that file as a module: code from a CDN, run in
 * the plugin's process, with nothing to say it is what this release was tested
 * with. Two changes close that:
 *
 * - The WebGPU build is swapped for the WebAssembly-only one, whose bundle
 *   carries the single-threaded glue (`ort-wasm-simd-threaded.mjs`, the plain
 *   build the model has always run on) inside itself. The glue is then part of
 *   main.js, and so of what the release attests.
 * - The CDN default is cut out of transformers.js, so no path back to jsDelivr
 *   is left in the bundle even if the frame's own settings were skipped.
 *
 * The WebAssembly module itself is not in the bundle; it is pinned by hash and
 * fetched from the plugin's release (`src/services/semantic/search-runtime.ts`).
 *
 * Both edits match exact text, and a dependency bump that moves that text fails
 * the build rather than quietly bundling the CDN path again.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** What transformers.js imports, and what it is given instead. */
export const RUNTIME_IMPORT = "onnxruntime-web/webgpu";
export const PINNED_RUNTIME_IMPORT = "onnxruntime-web/wasm";

/** The default transformers.js writes into the runtime's settings at import. */
const CDN_DEFAULT = "`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_ENV.versions.web}/dist/`";

/**
 * In its place: a prefix no loader can fetch. The frame clears the setting it
 * would have built before anything reads it; were that ever skipped, an import
 * from here fails at once, on the device, instead of reaching the network.
 */
const REFUSED_PREFIX = '"unpinned-runtime-refused:"';

/** transformers.js's browser build, the only file the CDN default is taken out of. */
const TRANSFORMERS_WEB = /[\\/]@huggingface[\\/]transformers[\\/]dist[\\/]transformers\.web\.js$/;

/** Hosts a bundle must never load code from; see `scripts/check-bundle.mjs`. */
export const CODE_CDNS = ["cdn.jsdelivr.net", "unpkg.com", "esm.sh", "cdnjs.cloudflare.com"];

/** transformers.js's source with the CDN default replaced; throws when it is not there once. */
export function withoutCdnDefault(source) {
  const count = source.split(CDN_DEFAULT).length - 1;
  if (count !== 1) {
    throw new Error(
      `transformers.js holds the onnxruntime CDN default ${count} times, not once: ` +
        "read how this version picks its runtime files before bundling it."
    );
  }
  return source.replace(CDN_DEFAULT, REFUSED_PREFIX);
}

/** The esbuild plugin that makes both edits. */
export function pinnedRuntimePlugin() {
  return {
    name: "pinned-search-runtime",
    setup(build) {
      build.onResolve({ filter: /^onnxruntime-web\/webgpu$/ }, async (args) => {
        const resolved = await build.resolve(PINNED_RUNTIME_IMPORT, {
          kind: args.kind,
          resolveDir: args.resolveDir
        });
        if (resolved.errors.length > 0) return { errors: resolved.errors };
        return { path: resolved.path };
      });
      build.onLoad({ filter: TRANSFORMERS_WEB }, async (args) => {
        return { contents: withoutCdnDefault(await readFile(args.path, "utf8")), loader: "js" };
      });
    }
  };
}

/** The embedding bundle as the text main.js carries. */
export async function buildEmbeddingBundle(esbuild, { minify }) {
  const result = await esbuild.build({
    absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
    entryPoints: ["src/controllers/semantic/host/frame/entry.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "esnext",
    write: false,
    minify,
    logLevel: "warning",
    plugins: [pinnedRuntimePlugin()]
  });
  return result.outputFiles[0].text;
}
