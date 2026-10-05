// Unified embedding backend entry (browser build, Pythia ADR-121). ONE bundle serves
// BOTH the Web Worker (off the UI thread) and the same-origin iframe fallback —
// it detects its context at runtime — so the heavy @huggingface/transformers
// runtime is bundled ONCE and inlined once into main.js (see embeddingBundle.ts),
// instead of twice. Replaces the former separate bootstrap.ts (iframe) and
// worker.ts (worker) entries.
//
//   Host  →  { type:"init", config, runtime } then { requestId, texts|ping }
//            (`runtime`: the WebAssembly module, checked by the host)
//   Both  →  { requestId, vectors[], error? }
//            { type:"model-load-progress"|"model-load-error", … }

import { EmbeddingModel } from "./model";
import type { EmbeddingModelConfig } from "../../../../services/semantic/embedding-models";

let model: EmbeddingModel | null = null;

/**
 * Chunks per inference call (Pythia ADR-182). 16 matches `scripts/measure-related.mjs`,
 * so in-app throughput is finally comparable with the number Pythia ADR-169 measured.
 *
 * NOT paired with `truncation: true`, deliberately. Truncating to the tokenizer's
 * `model_max_length` would change every vector longer than that window — which
 * would silently invalidate Pythia ADR-169's MEASURED `relatedFloors` and quietly drop
 * text that is embedded today. Chunks are sized to fit the window instead
 * (`embedChunkChars`), which is the non-destructive half of the same fix.
 */
const EMBED_BATCH_SIZE = 16;

function makeModel(
  config: EmbeddingModelConfig,
  runtime: unknown,
  reply: (m: unknown) => void
): void {
  model = new EmbeddingModel(config, runtime, (p) =>
    reply({
      type: "model-load-progress",
      progress: p.progress,
      file: p.file,
      loaded: p.loaded,
      total: p.total
    })
  );
  model.ready.catch((error: unknown) =>
    reply({
      type: "model-load-error",
      message: error instanceof Error ? error.message : String(error),
      offline: !navigator.onLine
    })
  );
}

async function handle(raw: unknown, reply: (m: unknown) => void): Promise<void> {
  // A message from another context: nothing about its shape is promised.
  const data: { requestId?: unknown; texts?: unknown; ping?: unknown; priority?: unknown } =
    typeof raw === "object" && raw !== null ? raw : {};
  const { requestId, texts, ping } = data;
  const priority = data.priority === true;
  if (typeof requestId !== "number") return;
  try {
    if (!model) throw new Error("embedding backend not initialized");
    await model.ready;
    if (ping) {
      reply({ requestId, vectors: [], ready: true });
      return;
    }
    const all = Array.isArray(texts)
      ? texts.filter((text): text is string => typeof text === "string")
      : [];
    const vectors: number[][] = [];
    for (let i = 0; i < all.length; i += EMBED_BATCH_SIZE) {
      const batch = await model.embedBatch(all.slice(i, i + EMBED_BATCH_SIZE), priority);
      for (const v of batch) vectors.push(Array.from(v));
    }
    reply({ requestId, vectors });
  } catch (error) {
    reply({
      requestId,
      vectors: [],
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * One message from the host. The first `init` makes the model; a second is
 * ignored rather than loading another model beside the first.
 */
function receive(raw: unknown, reply: (m: unknown) => void): void {
  const data: { type?: unknown; config?: unknown; runtime?: unknown } =
    typeof raw === "object" && raw !== null ? raw : {};
  if (data.type === "init") {
    if (!model && typeof data.config === "object" && data.config !== null) {
      makeModel(data.config as EmbeddingModelConfig, data.runtime, reply);
    }
    return;
  }
  void handle(raw, reply);
}

if (typeof window === "undefined") {
  // ── Web Worker: reply to the worker host. ──
  const ctx = self as unknown as {
    postMessage: (m: unknown) => void;
    onmessage: ((e: MessageEvent) => void) | null;
  };
  const reply = (m: unknown) => ctx.postMessage(m);
  ctx.onmessage = (event: MessageEvent): void => receive(event.data, reply);
} else {
  // ── Iframe: reply to the parent frame. ──
  window.addEventListener("message", (event: MessageEvent) => {
    const source = event.source as Window | null;
    // Only the host that mounted this frame (principle 1). The host already
    // checks the origin and the source of what comes back; this is the same
    // check in the other direction, so another frame in the window cannot ask
    // this one to embed text for it.
    if (!source || source !== window.parent) return;
    receive(event.data, (m) => source.postMessage(m, window.origin));
  });
}
