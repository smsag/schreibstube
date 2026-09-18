import type { LlmProvider, SchreibstubeSettings } from "../types";
import {
  DEFAULT_SETTINGS as DEFAULT_FOCUS_SETTINGS,
  normalizeFocusSettings
} from "./focus-settings";
import { LLM_PROVIDER_IDS, PROVIDER_MODELS } from "./llm-providers";

export { PROVIDER_MODELS } from "./llm-providers";

export const MIN_IMAGE_PX = 256;
export const MAX_IMAGE_PX = 2048;

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
};

/** Provider settings saved before 1.4.0 belonged to the rename feature.
 *  They now apply to every LLM feature and are read as a fallback. */
interface LegacyLlmSettings {
  renameProvider?: unknown;
  renameModel?: unknown;
  renameModelCustom?: unknown;
  renameSecretName?: unknown;
}

export function normalizeSettings(
  loaded: (Partial<SchreibstubeSettings> & LegacyLlmSettings) | null | undefined
): SchreibstubeSettings {
  const focus = normalizeFocusSettings(loaded);

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

  const llmModelCustom = stringOrDefault(
    loaded?.llmModelCustom ?? loaded?.renameModelCustom,
    DEFAULT_SETTINGS.llmModelCustom
  );

  const llmSecretName = stringOrDefault(
    loaded?.llmSecretName ?? loaded?.renameSecretName,
    DEFAULT_SETTINGS.llmSecretName
  );

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
  };
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function positiveIntOrDefault(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function clampIntOrDefault(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
