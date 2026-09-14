import { requestUrl } from "obsidian";
import { withTimeout } from "../utils/with-timeout";
import type { LlmProvider } from "../types";
import {
  REQUEST_TIMEOUT_MS,
  describeApiError,
  parseResponse,
  providerLabel,
  type BuiltRequest
} from "./llm-providers";

/** Send a prepared provider request and return the parsed text completion.
 *  Shared by every LLM-backed command (rename, summarize). */
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
    (seconds) => `${providerLabel(provider)}: request timed out after ${seconds}s.`
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(describeApiError(providerLabel(provider), response.status, response.text));
  }

  return parseResponse(provider, response.json);
}
