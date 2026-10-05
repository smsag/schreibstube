// Runs INSIDE the embedding Worker or iframe only — never imported by the main
// plugin bundle. This is the sole file that pulls in @huggingface/transformers,
// so the esbuild embedding pass (browser target) bundles it here while
// `main.js` carries the result only as a string. The runtime's JavaScript is in
// that bundle; its WebAssembly arrives from the host, checked against its pin;
// the model's files are fetched from Hugging Face at a pinned commit, checked
// against their pinned hashes, and cached by the browser.

import {
  AutoModel,
  AutoTokenizer,
  env,
  FeatureExtractionPipeline,
  type ProgressInfo
} from "@huggingface/transformers";
import type { EmbeddingModelConfig } from "../../../../services/semantic/embedding-models";
import { sliceBatch } from "./batch-slice";
import { pinRuntime, type WasmFlags } from "./runtime-build";
import {
  modelFileUrl,
  pinnedFetch,
  readModelPin,
  type ModelPin
} from "../../../../services/semantic/model-pins";
import { TaskQueue } from "./task-queue";

env.allowLocalModels = false;

/**
 * The fetch transformers.js was given at import; every model request goes
 * through `pinnedFetch` in front of it. A file read from the browser's cache
 * does not: it was checked on its way in, under a key that names the pinned
 * commit, and only code already running in Obsidian could have changed it.
 */
const unpinnedFetch = env.fetch as (input: string | URL, init?: RequestInit) => Promise<Response>;

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

// transformers.js's pipeline types form a union too large for TS to represent
// (TS2590), so the pipeline is cast to this minimal local signature.
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

export type ModelLoadProgress = { progress: number; file: string; loaded: number; total: number };
export type ModelLoadProgressCallback = (p: ModelLoadProgress) => void;

const TRANSFORMERS_CACHE = "transformers-cache";

/**
 * Whether the pinned model is in the browser's cache. transformers.js keys a
 * file by the address it fetched it from, and that address names the pinned
 * commit, so a new pin reads as not cached and is fetched and checked afresh.
 */
async function isModelCached(pin: ModelPin): Promise<boolean> {
  if (typeof caches === "undefined") return true;
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE);
    return (await cache.match(modelFileUrl(pin, "config.json"))) !== undefined;
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

  /** `runtime` and `pin`: the WebAssembly module and the model's pin the host sent, as they arrived. */
  constructor(
    config: EmbeddingModelConfig,
    runtime: unknown,
    pin: unknown,
    onProgress?: ModelLoadProgressCallback
  ) {
    this.config = config;
    this.ready = this.#initialize(runtime, pin, onProgress);
  }

  async #initialize(
    runtime: unknown,
    rawPin: unknown,
    onProgress?: ModelLoadProgressCallback
  ): Promise<void> {
    // Before anything can start the runtime: without its pinned module it
    // would go looking for one, and nothing it finds is checked.
    const problem = pinRuntime(wasm, runtime);
    if (problem !== null) throw new Error(problem);

    // The model's files the same way: one commit, every file checked before
    // the library reads it, and nothing fetched that the pin does not name.
    // Before the offline check, so a version without pins says that, not
    // that the device is offline.
    const pin = readModelPin(rawPin, this.config.repoId);
    if (typeof pin === "string") throw new Error(pin);
    env.fetch = pinnedFetch(unpinnedFetch, pin);

    if (!navigator.onLine && !(await isModelCached(pin))) {
      throw new Error(
        `The ${this.config.label} model has not been downloaded yet and you appear to be offline. ` +
          `Connect to the internet to finish setting up.`
      );
    }

    const progress = onProgress
      ? {
          progress_callback: (info: ProgressInfo) => {
            if (info.status === "progress") {
              onProgress({
                progress: info.progress,
                file: info.file,
                loaded: info.loaded,
                total: info.total
              });
            }
          }
        }
      : {};
    // The tokenizer and the model, each at the pinned revision, rather than
    // `pipeline()`: in transformers.js 4.3 it first works out which files to
    // load by reading config.json and probing tokenizer_config.json at `main`,
    // whatever revision it is given. The pinned fetch refused those requests,
    // and should: they are the unpinned path. Assembled by hand, every file is
    // asked for at the pinned commit — `scripts/embedding-smoke.mjs` shows it.
    //
    // Always the WASM backend. WebGPU compute is unstable in Obsidian's
    // Electron renderer — requesting a WebGPU device could hard-crash the GPU
    // process and reload the whole app. WASM is portable and stable (a bit
    // slower). Revisit WebGPU behind an opt-in once it's verified safe here.
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(this.config.repoId, { revision: pin.revision, ...progress }),
      AutoModel.from_pretrained(this.config.repoId, {
        revision: pin.revision,
        device: "wasm",
        dtype: "q8",
        ...progress
      })
    ]);
    this.#pipeline = new FeatureExtractionPipeline({
      task: "feature-extraction",
      model,
      tokenizer
    }) as unknown as FeaturePipeline;
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
