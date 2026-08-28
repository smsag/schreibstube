import { requestUrl } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import {
  REQUEST_TIMEOUT_MS,
  buildImageRequest,
  buildTextRequest,
  describeApiError,
  effectiveModel,
  extractModelFilename,
  parseResponse,
  providerLabel,
  type BuiltRequest
} from "./llm-providers";
import type { LlmProvider } from "../types";

export { sanitizeFilename } from "./llm-providers";

type RenameSettings = Pick<
  SchreibstubeSettings,
  "renameProvider" | "renameModel" | "renameModelCustom" | "renameMaxFilenameLength"
>;

export async function generateRenameFilename(
  content: string,
  settings: RenameSettings,
  apiKey: string
): Promise<string> {
  const request = buildTextRequest(
    settings.renameProvider,
    effectiveModel(settings),
    apiKey,
    content,
    settings.renameMaxFilenameLength
  );
  const raw = await sendRequest(settings.renameProvider, request);
  return extractModelFilename(raw);
}

export async function generateImageRenameFilename(
  base64Image: string,
  mimeType: string,
  settings: RenameSettings,
  apiKey: string
): Promise<string> {
  const request = buildImageRequest(
    settings.renameProvider,
    effectiveModel(settings),
    apiKey,
    base64Image,
    mimeType,
    settings.renameMaxFilenameLength
  );
  const raw = await sendRequest(settings.renameProvider, request);
  return extractModelFilename(raw);
}

async function sendRequest(provider: LlmProvider, request: BuiltRequest): Promise<string> {
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
