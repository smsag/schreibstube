import { requestUrl } from "obsidian";
import type { LlmProvider, SchreibstubeSettings } from "../types";
import {
  REQUEST_TIMEOUT_MS,
  buildPromptRequest,
  describeApiError,
  effectiveModel,
  parseResponse,
  providerLabel,
  type BuiltRequest
} from "./llm-providers";

export type LlmSettings = Pick<SchreibstubeSettings, "llmProvider" | "llmModel" | "llmModelCustom">;

/** Send a system + user prompt to the configured provider and return the raw reply text. */
export function requestCompletion(
  settings: LlmSettings,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number
): Promise<string> {
  const request = buildPromptRequest(
    settings.llmProvider,
    effectiveModel(settings),
    apiKey,
    systemPrompt,
    userMessage,
    maxTokens
  );
  return sendRequest(settings.llmProvider, request);
}

export async function sendRequest(provider: LlmProvider, request: BuiltRequest): Promise<string> {
  // Obsidian's requestUrl runs in the main process, so it bypasses the
  // renderer CORS restrictions that block direct fetch() to these APIs.
  const response = await withTimeout(
    requestUrl({
      url: request.url,
      method: "POST",
      headers: request.headers,
      body: request.body,
      throw: false
    }),
    REQUEST_TIMEOUT_MS,
    providerLabel(provider)
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(describeApiError(providerLabel(provider), response.status, response.text));
  }

  return parseResponse(provider, response.json);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error(`${label}: request timed out after ${Math.round(ms / 1000)}s.`)),
      ms
    );
  });
  return Promise.race([
    promise.finally(() => window.clearTimeout(timer)),
    timeout
  ]);
}
