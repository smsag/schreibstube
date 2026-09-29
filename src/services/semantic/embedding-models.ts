// The embedding models this plugin can run: pure data, imported by the settings
// and the services alike. The Xenova ONNX MiniLM family, all 384-dim; the model
// files download from HuggingFace on first use and are cached by the browser.

export type EmbeddingModelId =
  | "xenova-all-MiniLM-L6-v2"
  | "xenova-paraphrase-multilingual-MiniLM-L12-v2"
  | "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin";

export interface EmbeddingModelConfig {
  id: EmbeddingModelId;
  /** Short label for the settings dropdown. */
  label: string;
  /** HuggingFace repo id passed to transformers.js `pipeline()`. */
  repoId: string;
  /** Output dimensionality of the model. */
  dim: number;
  /** Max input tokens per embed call; longer text is truncated by the model. */
  maxTokens: number;
  /** Pooling strategy for the feature-extraction pipeline. */
  pooling: "mean" | "cls";
  /** Cosine floors for "related conversations", per strictness preset.
   *
   *  Per MODEL, because cosine distributions are not comparable across models —
   *  measured, not assumed (Pythia ADR-169, `scripts/measure-related.mjs`): over the
   *  same 554 chunks, the multilingual model's p90 pair score is 0.643 and the
   *  English model's is 0.567, and its best-neighbour median is 0.08 higher
   *  throughout. One shared constant therefore meant two different features
   *  depending on which model the dropdown selected. */
  relatedFloors: Record<SimilarityPreset, number>;
  /** Cosine floors for a conversation recommended beside a NOTE, per preset.
   *
   *  Not `relatedFloors`: those were measured conversation against conversation,
   *  and a note's heading sections against a conversation's packed 500-character
   *  chunks score lower across the board. At the note floor of 0.65, 4.95 % of
   *  note pairs cleared it and only 2.35 % of note–conversation pairs, so the
   *  panel recommended a conversation half as readily as a note on the same
   *  evidence. Each value here is the one that lets conversations through at the
   *  rate the note floor lets notes through — measured with
   *  `scripts/measure-conversation-floors.mjs` on 2026-09-28 over 383 notes and
   *  30 conversations. */
  conversationFloors: Record<SimilarityPreset, number>;
  /** Approximate size of the quantized model download, in MB — shown in the
   *  settings explainer so "downloads on first use" has a number attached. */
  downloadMb: number;
  /** Whether this model may run on Obsidian mobile (Pythia ADR-199).
   *
   *  MEASURED on an iPhone 15 Pro Max, iOS 26.6.2, 2026-09-22: iOS kills
   *  Obsidian's WebContent process at ~2 048 MB (`per-process-limit`). Obsidian
   *  plus a typical plugin set sits at ~640 MB; loading the English model adds
   *  ~130 MB, the multilingual one ~900–1 000 MB — after which the first
   *  inference crosses the limit and Obsidian reloads. Batch size was not the
   *  lever (batch 1 died too). Re-measure before flipping a flag. */
  mobile: boolean;
  /** Set on a VARIANT: a model that produces the same vectors as `variantOf`
   *  (Pythia ADR-200) and therefore shares its index files and its measured floors.
   *  A variant is never offered in the settings dropdown — it is what a device
   *  runs on behalf of the model the user chose. */
  variantOf?: EmbeddingModelId;
  /** What a variant gives up, for the settings note. */
  variantNote?: "latinScript";
}

/** How strict a similarity floor is: a label, so nobody reasons about raw
 *  cosines, which each model maps to a number in its own measured floors. */
export type SimilarityPreset = "strict" | "balanced" | "loose";

/** Where the pruned variant is published (Pythia ADR-200). A fork of the upstream model,
 *  Apache-2.0, built reproducibly by scripts/prune-embedding-model.py. */
export const LATIN_VARIANT_REPO_ID = "smsag007/paraphrase-multilingual-MiniLM-L12-v2-latin";

export const EMBEDDING_MODELS: Record<EmbeddingModelId, EmbeddingModelConfig> = {
  "xenova-all-MiniLM-L6-v2": {
    id: "xenova-all-MiniLM-L6-v2",
    label: "English",
    repoId: "Xenova/all-MiniLM-L6-v2",
    dim: 384,
    maxTokens: 256,
    pooling: "mean",
    // p75 / p90 / p95 of this model's own pair distribution (Pythia ADR-169).
    relatedFloors: { loose: 0.45, balanced: 0.57, strict: 0.67 },
    // Not measured: no vault indexed with this model was at hand. The related
    // floors stand until one is.
    conversationFloors: { loose: 0.45, balanced: 0.57, strict: 0.67 },
    downloadMb: 25,
    mobile: true
  },
  "xenova-paraphrase-multilingual-MiniLM-L12-v2": {
    id: "xenova-paraphrase-multilingual-MiniLM-L12-v2",
    label: "Multilingual",
    repoId: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    dim: 384,
    maxTokens: 128,
    pooling: "mean",
    // The same percentiles, ~0.08 higher throughout — this model scores every
    // pair hotter, which is exactly why the floors cannot be shared (Pythia ADR-169).
    relatedFloors: { loose: 0.55, balanced: 0.65, strict: 0.75 },
    conversationFloors: { loose: 0.54, balanced: 0.62, strict: 0.66 },
    downloadMb: 120,
    mobile: false
  },
  // The multilingual model with its vocabulary cut to Latin-script pieces
  // (Pythia ADR-200): 128 507 of 250 002 pieces, built by scripts/prune-embedding-model.py
  // from the upstream files. Latin-script text can only ever tokenize to kept
  // pieces, so its segmentation — and its vector — is IDENTICAL to the full
  // model's (verified: cosine 1.0000 on 408 texts in five languages). Other
  // scripts fall back to single characters. Measured on the iPhone: ≈ +370–400 MB
  // where the full model was +900–1 000 MB and the kill line is ~2 GB.
  "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin": {
    id: "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin",
    label: "Multilingual (Latin script)",
    repoId: LATIN_VARIANT_REPO_ID,
    dim: 384,
    maxTokens: 128,
    pooling: "mean",
    // Not re-measured: the same vectors have the same distribution
    // (tests/embeddingModelRule.test.ts holds these equal to the family's).
    relatedFloors: { loose: 0.55, balanced: 0.65, strict: 0.75 },
    conversationFloors: { loose: 0.54, balanced: 0.62, strict: 0.66 },
    downloadMb: 75,
    mobile: true,
    variantOf: "xenova-paraphrase-multilingual-MiniLM-L12-v2",
    variantNote: "latinScript"
  }
};

/** Default for a bilingual (DE + EN) vault. */
export const DEFAULT_EMBEDDING_MODEL_ID: EmbeddingModelId =
  "xenova-paraphrase-multilingual-MiniLM-L12-v2";

export const SIMILARITY_PRESETS: readonly SimilarityPreset[] = ["strict", "balanced", "loose"];
export const DEFAULT_SIMILARITY_PRESET: SimilarityPreset = "balanced";

/** Every known model id, for validating a persisted setting. */
export const EMBEDDING_MODEL_IDS: readonly EmbeddingModelId[] = Object.keys(
  EMBEDDING_MODELS
) as EmbeddingModelId[];

/** The models a user can choose — variants are picked by the device, never by hand. */
export const SELECTABLE_EMBEDDING_MODEL_IDS: readonly EmbeddingModelId[] =
  EMBEDDING_MODEL_IDS.filter((id) => !EMBEDDING_MODELS[id].variantOf);

/**
 * Which build of the embedding runtime produced a vector, as a number rows can carry.
 *
 * A vector is a function of the model AND the code that runs it. Measured when
 * transformers 3.8.1 (onnxruntime-web 1.22) gave way to 4.3.0 (onnxruntime-web 1.31),
 * on the English model, ten notes: the unquantized weights embed identically
 * (cosine ≥ 0.99999), but the 8-bit weights Schreibstube loads do not — cosine
 * 0.992–0.995 between the two runtimes' vectors of the same text, pairwise
 * similarities moved by up to 0.022, and the nearest neighbour changed for two
 * notes in ten. An index holding rows from both would rank one note against
 * another with numbers from two different instruments, so a row embedded under
 * an older generation is re-embedded rather than reused.
 *
 * Generation 1 is every row written before this existed; its hashes carry no mark.
 * `tests` compare `transformers` and `onnxruntimeWeb` against the lockfile, so a
 * dependency bump fails until someone measures it and either raises the
 * generation or records that the vectors did not move.
 */
export const EMBEDDING_RUNTIME = {
  generation: 2,
  transformers: "4.3.0",
  onnxruntimeWeb: "1.31.0-dev.20260914-8d85527a0"
} as const;

/** The model whose vectors `id` produces (Pythia ADR-200): a variant's family, else itself.
 *  Index files are named by this, so a device on a variant reads — and extends —
 *  the index another device built with the full model. */
export function vectorFamily(id: EmbeddingModelId): EmbeddingModelId {
  return embeddingModelConfig(id).variantOf ?? embeddingModelConfig(id).id;
}

export function embeddingModelConfig(id: EmbeddingModelId): EmbeddingModelConfig {
  return EMBEDDING_MODELS[id] ?? EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL_ID];
}

/** The model a phone or tablet runs when the chosen one is not `mobile` (Pythia ADR-199). */
export const MOBILE_EMBEDDING_MODEL_ID: EmbeddingModelId = "xenova-all-MiniLM-L6-v2";

/**
 * The model that actually embeds on this device — the ONE place that answers it
 * (Pythia ADR-199, variants Pythia ADR-200). Everything that loads a model, opens an index file, or picks a
 * floor goes through here; `settings.embeddingModelId` is read nowhere else
 * (`tests/embeddingModelRule.test.ts` fails on a second reader).
 *
 * The setting is never rewritten: it syncs through data.json, so storing the
 * mobile substitute would switch the desktop too (principle 6). The phone uses
 * its own model and its own index file (`<prefix>-<modelId>.bin`) beside the
 * desktop's.
 */
export function effectiveEmbeddingModel(
  setting: EmbeddingModelId,
  isMobile: boolean
): EmbeddingModelId {
  const chosen = embeddingModelConfig(setting);
  if (!isMobile || chosen.mobile) return chosen.id;
  // A mobile variant with the same vectors beats a different model (Pythia ADR-200):
  // the phone keeps cross-language matching AND the desktop's index.
  const variant = EMBEDDING_MODEL_IDS.find((id) => {
    const c = EMBEDDING_MODELS[id];
    return c.mobile && c.variantOf === chosen.id;
  });
  return variant ?? MOBILE_EMBEDDING_MODEL_ID;
}

/** Conservative chars-per-token for sizing a chunk against a token window.
 *
 *  German through the XLM-R tokenizer runs ~3.3–3.6 chars/token and English ~4;
 *  markdown (wikilinks, URLs, code) tokenizes worse than either. Sized to the
 *  pessimistic end on purpose: undersizing costs a few extra chunks, oversizing
 *  pushes text past the model's window where it contributes nothing. */
const CHARS_PER_TOKEN = 3.3;

/**
 * How many characters of note text one embed chunk should carry, for `id`.
 *
 * Until Pythia ADR-182 `maxTokens` was declared on every model and read by nothing: both
 * indexes chunked at a hardcoded 500 chars. That is ~150 tokens of German — over
 * the default (multilingual) model's 128-token window, and only ~60% of the
 * English model's 256. The window is a property of the model, so the chunk size
 * has to be too.
 *
 * Used for the VAULT index only. The conversation index deliberately stays at its
 * historical 500: Pythia ADR-169's `relatedFloors` were MEASURED at that chunk size, and
 * changing it would move the cosine distribution the floors are calibrated
 * against — re-measure with `scripts/measure-related.mjs` first (Pythia D-13/Pythia D-14).
 */
export function embedChunkChars(id: EmbeddingModelId): number {
  return Math.floor(embeddingModelConfig(id).maxTokens * CHARS_PER_TOKEN);
}
