// How the model runtime is handed the WebAssembly it runs, so it fetches none.
//
// Lives apart from `model.ts` so it can be unit-tested: `model.ts` imports
// @huggingface/transformers at module scope, which no test environment can load.

/** The runtime's WebAssembly settings, as far as they are used here. */
export interface WasmFlags {
  numThreads?: number;
  proxy?: boolean;
  wasmPaths?: unknown;
  wasmBinary?: unknown;
}

/**
 * Give the runtime the module the host fetched, checked and sent, and take away
 * every setting that would make it fetch one itself. Returns what is wrong, or
 * null.
 *
 * The bundle already carries the instantiating JavaScript for the plain
 * single-threaded build (`scripts/embedding-bundle.mjs`), and onnxruntime-web
 * uses that copy only when it is given the module's bytes, no file paths and
 * one thread. With paths set it would import the JavaScript from them instead,
 * so they are cleared, never merely left for the library to fill: the library
 * fills them with a CDN by default.
 *
 * One thread, because the threaded build spawns nested workers on a
 * SharedArrayBuffer, which can take Obsidian's Electron renderer down with it
 * (Pythia ADR-119); one heap, too. No proxy, because the proxy starts a worker
 * of its own from a URL. And the plain build rather than the WebGPU-ready one
 * transformers.js would choose: measured in a WKWebView with the Latin-script
 * model and batches of 16, 740–800 MB at the peak against 1 340–1 380 MB, with
 * bit-identical vectors. On an iPhone, whose web process is ended at 2 GB, the
 * difference is whether Obsidian keeps running.
 */
export function pinRuntime(wasm: WasmFlags | undefined, binary: unknown): string | null {
  if (!wasm) return "the runtime has no WebAssembly settings to pin";
  wasm.numThreads = 1;
  wasm.proxy = false;
  wasm.wasmPaths = undefined;
  // It crossed from another context: nothing about its shape is promised.
  if (!(binary instanceof ArrayBuffer) || binary.byteLength === 0) {
    return "the runtime's WebAssembly module did not arrive";
  }
  wasm.wasmBinary = new Uint8Array(binary);
  return null;
}
