import type { LlmProvider, SchreibstubeSettings } from "../types";
import {
  DEFAULT_SETTINGS as DEFAULT_FOCUS_SETTINGS,
  normalizeFocusSettings
} from "./focus-settings";

export const MIN_OVERLAY_VISIBLE_ROWS = 3;
export const MAX_OVERLAY_VISIBLE_ROWS = 20;

export const MIN_IMAGE_PX = 256;
export const MAX_IMAGE_PX = 2048;

export const PROVIDER_MODELS: Record<LlmProvider, { label: string; value: string }[]> = {
  anthropic: [
    { label: "Claude Haiku 4.5 (recommended)", value: "claude-haiku-4-5-20251001" },
    { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
  ],
  openai: [
    { label: "GPT-4o mini (recommended)", value: "gpt-4o-mini" },
    { label: "GPT-4o", value: "gpt-4o" },
  ],
};

const ALLOWED_PROVIDERS = new Set<LlmProvider>(["anthropic", "openai"]);

export const DEFAULT_SETTINGS: SchreibstubeSettings = {
  ...DEFAULT_FOCUS_SETTINGS,
  overlayEnabled: true,
  overlayMaxVisibleRows: 6,
  renameProvider: "anthropic",
  renameModel: "claude-haiku-4-5-20251001",
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

  const renameSecretName =
    typeof loaded?.renameSecretName === "string" ? loaded.renameSecretName : DEFAULT_SETTINGS.renameSecretName;

  return {
    ...focus,
    overlayEnabled:
      typeof loaded?.overlayEnabled === "boolean"
        ? loaded.overlayEnabled
        : DEFAULT_SETTINGS.overlayEnabled,
    overlayMaxVisibleRows: clampIntOrDefault(
      loaded?.overlayMaxVisibleRows,
      MIN_OVERLAY_VISIBLE_ROWS,
      MAX_OVERLAY_VISIBLE_ROWS,
      DEFAULT_SETTINGS.overlayMaxVisibleRows
    ),
    renameProvider: provider,
    renameModel: model,
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
