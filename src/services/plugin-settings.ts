import type { LlmProvider, SchreibstubeSettings } from "../types";
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
  summarizePrompt: DEFAULT_SUMMARIZE_PROMPT,
  summarizeMaxTokens: 512,
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
  };
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
