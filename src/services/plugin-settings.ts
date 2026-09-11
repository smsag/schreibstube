import type { LlmProvider, SchreibstubeSettings } from "../types";
import type { SyncRecord } from "./sync-document";
import {
  DEFAULT_SETTINGS as DEFAULT_FOCUS_SETTINGS,
  normalizeFocusSettings
} from "./focus-settings";
import { LLM_PROVIDER_IDS, PROVIDER_MODELS } from "./llm-providers";

export { PROVIDER_MODELS } from "./llm-providers";

export const MIN_IMAGE_PX = 256;
export const MAX_IMAGE_PX = 2048;

export const MIN_SUMMARY_TOKENS = 64;
export const MAX_SUMMARY_TOKENS = 4096;

export const MIN_PROOFREAD_TOKENS = 256;
export const MAX_PROOFREAD_TOKENS = 8192;

/** Characters of prose per request. Small chunks give earlier cards but cost
 *  more requests; large ones risk the model's attention drifting late in a
 *  long stretch of text. */
export const MIN_CHUNK_CHARS = 500;
export const MAX_CHUNK_CHARS = 6000;

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 4;

/** Floor between automatic source checks for one note, so opening a mirror
 *  repeatedly does not hammer the source. */
export const MIN_SYNC_INTERVAL_MINUTES = 0;
export const MAX_SYNC_INTERVAL_MINUTES = 120;

/** Default summarize prompt, tuned for turning raw text pasted from analytics
 *  and reporting tools into a compact insight-log entry. */
export const DEFAULT_SUMMARIZE_PROMPT =
  "You distill raw text into a concise insight log entry. The user pastes text " +
  "copied from an analytics or reporting tool. Rewrite it as Markdown bullet points — " +
  "one per distinct insight, using as many or as few as the content genuinely warrants: " +
  "a single line for a small or simple selection, more for a rich one. Never pad to reach " +
  "a count. Capture the key findings and takeaways, keeping concrete numbers, metrics, and " +
  "named entities. Drop UI labels, navigation, and boilerplate. Respond with the insight " +
  "only — no preamble, no closing remarks.";

/** Default proof-read prompt. Correction only: the instruction is deliberately
 *  narrow, because a prompt that also invites improvement produces rewrites the
 *  author has to argue with rather than corrections they can accept. */
export const DEFAULT_PROOFREAD_PROMPT =
  "Du bist Korrektor für deutschsprachige Fachtexte. Korrigiere Rechtschreibung, " +
  "Grammatik, Zeichensetzung und offensichtliche Stilfehler. Ändere niemals die " +
  "Aussage, den Ton oder die Fachbegriffe des Textes. Kürze nicht und ergänze nichts.";

const ALLOWED_PROVIDERS = new Set<LlmProvider>(LLM_PROVIDER_IDS);

export const DEFAULT_SETTINGS: SchreibstubeSettings = {
  ...DEFAULT_FOCUS_SETTINGS,
  overlayEnabled: true,
  llmProvider: "anthropic",
  llmModel: "claude-haiku-4-5-20251001",
  llmModelCustom: "",
  llmSecretName: "",
  renameMinContentChars: 50,
  renameMaxContentChars: 4000,
  renameMaxFilenameLength: 60,
  renameMaxImagePx: 768,
  summarizePrompt: DEFAULT_SUMMARIZE_PROMPT,
  summarizeMaxTokens: 512,
  proofreadPrompt: DEFAULT_PROOFREAD_PROMPT,
  proofreadMaxTokens: 2048,
  proofreadChunkChars: 2000,
  proofreadConcurrency: 2,
  glossaryDefault: [],
  glossaryFolderRules: "",
  glossaryLiveUnderline: false,
  syncEnabled: false,
  syncCheckOnOpen: true,
  syncMinIntervalMinutes: 10,
  syncState: {},
  debugLogging: false,
};

/** Settings as persisted may predate the rename→llm rename of the shared LLM
 *  keys, so `normalizeSettings` accepts the legacy field names too. */
interface LegacyLlmSettings {
  renameProvider?: unknown;
  renameModel?: unknown;
  renameModelCustom?: unknown;
  renameSecretName?: unknown;
}

type LoadedSettings = (Partial<SchreibstubeSettings> & LegacyLlmSettings) | null | undefined;

export function normalizeSettings(loaded: LoadedSettings): SchreibstubeSettings {
  const focus = normalizeFocusSettings(loaded);

  // Prefer the current key, falling back to the pre-1.4 `rename*` name so
  // existing users keep their configured provider/model/key across the rename.
  const loadedProvider = loaded?.llmProvider ?? loaded?.renameProvider ?? "";
  const provider: LlmProvider = ALLOWED_PROVIDERS.has(loadedProvider as LlmProvider)
    ? (loadedProvider as LlmProvider)
    : DEFAULT_SETTINGS.llmProvider;

  const providerModels = PROVIDER_MODELS[provider];
  const modelValues = providerModels.map((m) => m.value);
  const loadedModel = loaded?.llmModel ?? loaded?.renameModel ?? "";
  const model = modelValues.includes(loadedModel as string)
    ? (loadedModel as string)
    : providerModels[0].value;

  const loadedModelCustom = loaded?.llmModelCustom ?? loaded?.renameModelCustom;
  const llmModelCustom =
    typeof loadedModelCustom === "string" ? loadedModelCustom : DEFAULT_SETTINGS.llmModelCustom;

  const loadedSecretName = loaded?.llmSecretName ?? loaded?.renameSecretName;
  const llmSecretName =
    typeof loadedSecretName === "string" ? loadedSecretName : DEFAULT_SETTINGS.llmSecretName;

  return {
    ...focus,
    overlayEnabled:
      typeof loaded?.overlayEnabled === "boolean"
        ? loaded.overlayEnabled
        : DEFAULT_SETTINGS.overlayEnabled,
    llmProvider: provider,
    llmModel: model,
    llmModelCustom,
    llmSecretName,
    debugLogging:
      typeof loaded?.debugLogging === "boolean"
        ? loaded.debugLogging
        : DEFAULT_SETTINGS.debugLogging,
    renameMinContentChars: positiveIntOrDefault(
      loaded?.renameMinContentChars,
      DEFAULT_SETTINGS.renameMinContentChars
    ),
    renameMaxContentChars: positiveIntOrDefault(
      loaded?.renameMaxContentChars,
      DEFAULT_SETTINGS.renameMaxContentChars
    ),
    renameMaxFilenameLength: positiveIntOrDefault(
      loaded?.renameMaxFilenameLength,
      DEFAULT_SETTINGS.renameMaxFilenameLength
    ),
    renameMaxImagePx: clampIntOrDefault(
      loaded?.renameMaxImagePx,
      MIN_IMAGE_PX,
      MAX_IMAGE_PX,
      DEFAULT_SETTINGS.renameMaxImagePx
    ),
    summarizePrompt: nonEmptyStringOrDefault(
      loaded?.summarizePrompt,
      DEFAULT_SETTINGS.summarizePrompt
    ),
    summarizeMaxTokens: clampIntOrDefault(
      loaded?.summarizeMaxTokens,
      MIN_SUMMARY_TOKENS,
      MAX_SUMMARY_TOKENS,
      DEFAULT_SETTINGS.summarizeMaxTokens
    ),
    proofreadPrompt: nonEmptyStringOrDefault(
      loaded?.proofreadPrompt,
      DEFAULT_SETTINGS.proofreadPrompt
    ),
    proofreadMaxTokens: clampIntOrDefault(
      loaded?.proofreadMaxTokens,
      MIN_PROOFREAD_TOKENS,
      MAX_PROOFREAD_TOKENS,
      DEFAULT_SETTINGS.proofreadMaxTokens
    ),
    proofreadChunkChars: clampIntOrDefault(
      loaded?.proofreadChunkChars,
      MIN_CHUNK_CHARS,
      MAX_CHUNK_CHARS,
      DEFAULT_SETTINGS.proofreadChunkChars
    ),
    proofreadConcurrency: clampIntOrDefault(
      loaded?.proofreadConcurrency,
      MIN_CONCURRENCY,
      MAX_CONCURRENCY,
      DEFAULT_SETTINGS.proofreadConcurrency
    ),
    glossaryDefault: stringListOrDefault(loaded?.glossaryDefault),
    glossaryFolderRules:
      typeof loaded?.glossaryFolderRules === "string"
        ? loaded.glossaryFolderRules
        : DEFAULT_SETTINGS.glossaryFolderRules,
    glossaryLiveUnderline:
      typeof loaded?.glossaryLiveUnderline === "boolean"
        ? loaded.glossaryLiveUnderline
        : DEFAULT_SETTINGS.glossaryLiveUnderline,
    syncEnabled:
      typeof loaded?.syncEnabled === "boolean" ? loaded.syncEnabled : DEFAULT_SETTINGS.syncEnabled,
    syncCheckOnOpen:
      typeof loaded?.syncCheckOnOpen === "boolean"
        ? loaded.syncCheckOnOpen
        : DEFAULT_SETTINGS.syncCheckOnOpen,
    syncMinIntervalMinutes: clampIntOrDefault(
      loaded?.syncMinIntervalMinutes,
      MIN_SYNC_INTERVAL_MINUTES,
      MAX_SYNC_INTERVAL_MINUTES,
      DEFAULT_SETTINGS.syncMinIntervalMinutes
    ),
    syncState: syncStateOrDefault(loaded?.syncState),
  };
}

/** Sync state is plugin-written, but it lives in the same data file a user can
 *  edit, so every record is validated rather than trusted. */
function syncStateOrDefault(value: unknown): Record<string, SyncRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Record<string, SyncRecord> = {};
  for (const [path, record] of Object.entries(value as Record<string, unknown>)) {
    if (!record || typeof record !== "object") continue;
    const { hash, etag, checkedAt } = record as Partial<SyncRecord>;
    if (typeof hash !== "string" || hash.length === 0) continue;
    result[path] = {
      hash,
      etag: typeof etag === "string" ? etag : "",
      checkedAt: Number.isFinite(checkedAt) ? Number(checkedAt) : 0,
    };
  }
  return result;
}

/** Glossary paths are persisted as an array; anything else in the data file is
 *  treated as unset rather than crashing the whole settings load. */
function stringListOrDefault(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function nonEmptyStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function positiveIntOrDefault(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function clampIntOrDefault(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
