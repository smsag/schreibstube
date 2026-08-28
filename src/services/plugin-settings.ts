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
  renameProvider: "anthropic",
  renameModel: "claude-haiku-4-5-20251001",
  renameModelCustom: "",
  renameSecretName: "",
  renameMinContentChars: 50,
  renameMaxContentChars: 4000,
  renameMaxFilenameLength: 60,
  renameMaxImagePx: 768,
};

export function normalizeSettings(
  loaded: Partial<SchreibstubeSettings> | null | undefined
): SchreibstubeSettings {
  const focus = normalizeFocusSettings(loaded);

  const loadedProvider = loaded?.renameProvider ?? "";
  const provider: LlmProvider = ALLOWED_PROVIDERS.has(loadedProvider as LlmProvider)
    ? (loadedProvider as LlmProvider)
    : DEFAULT_SETTINGS.renameProvider;

  const providerModels = PROVIDER_MODELS[provider];
  const modelValues = providerModels.map((m) => m.value);
  const loadedModel = loaded?.renameModel ?? "";
  const model = modelValues.includes(loadedModel) ? loadedModel : providerModels[0].value;

  const renameModelCustom =
    typeof loaded?.renameModelCustom === "string"
      ? loaded.renameModelCustom
      : DEFAULT_SETTINGS.renameModelCustom;

  const renameSecretName =
    typeof loaded?.renameSecretName === "string" ? loaded.renameSecretName : DEFAULT_SETTINGS.renameSecretName;

  return {
    ...focus,
    overlayEnabled:
      typeof loaded?.overlayEnabled === "boolean"
        ? loaded.overlayEnabled
        : DEFAULT_SETTINGS.overlayEnabled,
    renameProvider: provider,
    renameModel: model,
    renameModelCustom,
    renameSecretName,
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

function positiveIntOrDefault(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function clampIntOrDefault(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
