import type { SchreibstubeSettings } from "../types";
import { buildSummaryRequest, effectiveModel } from "./llm-providers";
import { sendRequest } from "./llm-client";

type SummarizeSettings = Pick<
  SchreibstubeSettings,
  | "llmProvider"
  | "llmModel"
  | "llmModelCustom"
  | "summarizePrompt"
  | "summarizeMaxTokens"
>;

/** Send the selected text to the configured LLM and return its summary,
 *  using the user's summarize prompt as the system instruction. Reuses the
 *  shared LLM provider, model, and API key. */
export async function generateSummary(
  text: string,
  settings: SummarizeSettings,
  apiKey: string
): Promise<string> {
  const request = buildSummaryRequest(
    settings.llmProvider,
    effectiveModel(settings),
    apiKey,
    settings.summarizePrompt,
    text,
    settings.summarizeMaxTokens
  );
  const raw = await sendRequest(settings.llmProvider, request);
  return raw.trim();
}
