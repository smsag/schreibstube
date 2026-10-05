// Runs INSIDE the embedding Worker or iframe only — never imported by the main
// plugin bundle. This is the sole file that pulls in @huggingface/transformers,
// so the esbuild embedding pass (browser target) bundles it here while
// `main.js` carries the result only as a string. The runtime's JavaScript is in
// that bundle; its WebAssembly arrives from the host, checked against its pin;
// the model weights are fetched from Hugging Face and cached by the browser.

import { env, pipeline, type ProgressInfo } from "@huggingface/transformers";
import type { EmbeddingModelConfig } from "../../../../services/semantic/embedding-models";
import { sliceBatch } from "./batch-slice";
import { pinRuntime, type WasmFlags } from "./runtime-build";
import { TaskQueue } from "./task-queue";

env.allowLocalModels = false;

// The onnx backend is initialized at transformers import time, so its settings
// exist here. Typed as optional against transformers' own types, which promise
// the shape this guard exists to doubt.
const wasm = (env.backends as { onnx?: { wasm?: WasmFlags } } | undefined)?.onnx?.wasm;
if (!wasm) {
  // NEVER silent (principle 2). Reachable when transformers resolves to the
  // NODE backend, whose binding has no `.wasm` — precisely the case the Worker
  // prelude removes (Pythia ADR-182). The model then refuses to load (see
  // `pinRuntime`) rather than run unpinned; this says why, in the only console
  // the worker or the frame has.
  console.error("[Schreibstube] semantic engine: onnx wasm backend absent — runtime not pinned");
}

// transformers.js's `pipeline()` overloads produce a union type too large for TS
// to represent (TS2590), so we cast to these minimal local signatures.
// `padding` is what makes a BATCH possible: without it transformers refuses a
// multi-text call whose members tokenize to different lengths. Padding itself is
// neutral for mean pooling — the attention mask excludes the pad positions — but
// batching is not quite: the 8-bit weights quantize activations with one scale per
// batch, so a text's vector depends a little on what it is batched with. Measured
// on the multilingual model: with full-precision weights a text embeds identically
// alone and beside any other; with `q8` it embeds identically beside itself, and at
// cosine 0.995–0.996 beside a different text, padded or not — under 3.8.1 and 4.3.0
// alike. That is noise far below the related floors (Pythia ADR-169), which is why
// they were not re-measured; it is not zero, so the same note embedded in two
// batches need not produce the same bytes.
// `truncation` is deliberately NOT here: see EMBED_BATCH_SIZE's note.
type FeaturePipeline = (
  input: string | string[],
  opts: { pooling: "mean" | "cls"; normalize: boolean; padding?: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>;
type CreatePipeline = (
  task: "feature-extraction",
  model: string,
  options?: Record<string, unknown>
) => Promise<FeaturePipeline>;
const createPipeline = pipeline as unknown as CreatePipeline;

export type ModelLoadProgress = { progress: number; file: string; loaded: number; total: number };
export type ModelLoadProgressCallback = (p: ModelLoadProgress) => void;

const TRANSFORMERS_CACHE = "transformers-cache";
const cacheKeyFor = (repoId: string, file: string) =>
  `https://huggingface.co/${repoId}/resolve/main/${file}`;

async function isModelCached(repoId: string): Promise<boolean> {
  if (typeof caches === "undefined") return true;
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE);
    return (await cache.match(cacheKeyFor(repoId, "config.json"))) !== undefined;
  } catch {
    return true;
  }
}

export class EmbeddingModel {
  #pipeline: FeaturePipeline | null = null;
  /** Inference calls, one at a time; a search goes ahead of waiting batches. */
  readonly #queue = new TaskQueue();
  readonly config: EmbeddingModelConfig;
  ready: Promise<void>;

  /** `runtime`: the WebAssembly module the host sent, as it arrived. */
  constructor(
    config: EmbeddingModelConfig,
    runtime: unknown,
    onProgress?: ModelLoadProgressCallback
  ) {
    this.config = config;
    this.ready = this.#initialize(runtime, onProgress);
  }

  async #initialize(runtime: unknown, onProgress?: ModelLoadProgressCallback): Promise<void> {
    // Before anything can start the runtime: without its pinned module it
    // would go looking for one, and nothing it finds is checked.
    const problem = pinRuntime(wasm, runtime);
    if (problem !== null) throw new Error(problem);

    if (!navigator.onLine && !(await isModelCached(this.config.repoId))) {
      throw new Error(
        `The ${this.config.label} model has not been downloaded yet and you appear to be offline. ` +
          `Connect to the internet to finish setting up.`
      );
    }

    // Always the WASM backend. WebGPU compute is unstable in Obsidian's
    // Electron renderer — requesting a WebGPU device could hard-crash the GPU
    // process and reload the whole app. WASM is portable and stable (a bit
    // slower). Revisit WebGPU behind an opt-in once it's verified safe here.
    this.#pipeline = await createPipeline("feature-extraction", this.config.repoId, {
      device: "wasm",
      dtype: "q8",
      progress_callback: onProgress
        ? (info: ProgressInfo) => {
            if (info.status === "progress") {
              onProgress({
                progress: info.progress,
                file: info.file,
                loaded: info.loaded,
                total: info.total
              });
            }
          }
        : undefined
    });
  }

  /**
   * Embed a BATCH of strings in ONE inference, serialized behind the queue so
   * calls never overlap (Pythia ADR-182).
   *
   * Batch-of-one was the old shape, and it cost twice. Throughput: one ONNX
   * session run per chunk, so a 400-note vault paid several thousand round
   * trips. And memory: every call ran at its own sequence length, so
   * onnxruntime-web allocated a fresh execution plan and arena per distinct
   * shape, and WASM linear memory only ever grows — which is why a build
   * "started strong and deteriorated at roughly half" and eventually took the
   * renderer with it.
   *
   * Padding collapses a batch to ONE shape and cuts the number of distinct
   * shapes (and of calls) by the batch size. Returns one vector per input, in
   * input order.
   */
  embedBatch(inputs: string[], priority = false): Promise<Float32Array[]> {
    return this.#queue.run(async () => {
      if (!this.#pipeline) throw new Error("pipeline not initialized");
      if (inputs.length === 0) return [];
      const result = await this.#pipeline(inputs, {
        pooling: this.config.pooling,
        normalize: true,
        padding: true
      });
      return sliceBatch(result.data, result.dims, inputs.length);
    }, priority);
  }
}
