import type { SchreibstubeSettings } from "../types";
import { buildSummaryRequest, effectiveModel } from "./llm-providers";
import { sendRequest } from "./llm-client";

type SummarizeSettings = Pick<
  SchreibstubeSettings,
  | "renameProvider"
  | "renameModel"
  | "renameModelCustom"
  | "summarizePrompt"
  | "summarizeMaxTokens"
>;

/** Send the selected text to the configured LLM and return its summary,
 *  using the user's summarize prompt as the system instruction. Reuses the
 *  provider, model, and API key configured for the rename feature. */
export async function generateSummary(
  text: string,
  settings: SummarizeSettings,
  apiKey: string
): Promise<string> {
  const request = buildSummaryRequest(
    settings.renameProvider,
    effectiveModel(settings),
    apiKey,
    settings.summarizePrompt,
    text,
    settings.summarizeMaxTokens
  );
  const raw = await sendRequest(settings.renameProvider, request);
  return raw.trim();
}
