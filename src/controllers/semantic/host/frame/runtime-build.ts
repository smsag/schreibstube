// Which WebAssembly build of the model runtime to load.
//
// Lives apart from `model.ts` so it can be unit-tested: `model.ts` imports
// @huggingface/transformers at module scope, which no test environment can load.

/** Where the runtime's builds are served from; the library's own default. */
const RUNTIME_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@";

/**
 * The plain single-threaded build of the runtime, for the version the library
 * bundles, or null when that version cannot be read — the library's own
 * choice then stands.
 *
 * transformers.js 4 loads the "asyncify" build everywhere except Safari below
 * 26. That build exists for WebGPU, which the model never uses here, and it
 * costs twice the memory: measured in a WKWebView with the Latin-script model
 * and batches of 16, 1 340–1 380 MB at the peak against 740–800 MB with this
 * build, with bit-identical vectors and the same speed. On an iPhone, whose web
 * process is ended at 2 GB, the difference is whether Obsidian keeps running.
 */
export function plainRuntimePaths(version: unknown): { mjs: string; wasm: string } | null {
  // Read off the library at run time: anything but a version would end up
  // in a URL the runtime loads code from.
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    return null;
  }
  const base = `${RUNTIME_CDN}${version}/dist/ort-wasm-simd-threaded`;
  return { mjs: `${base}.mjs`, wasm: `${base}.wasm` };
}
