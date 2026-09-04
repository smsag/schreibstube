import type { SchreibstubeSettings } from "../types";
import {
  buildImageRequest,
  buildTextRequest,
  effectiveModel,
  extractModelFilename
} from "./llm-providers";
import { sendRequest } from "./llm-client";

export { sanitizeFilename } from "./llm-providers";

type RenameSettings = Pick<
  SchreibstubeSettings,
  "llmProvider" | "llmModel" | "llmModelCustom" | "renameMaxFilenameLength"
>;

export async function generateRenameFilename(
  content: string,
  settings: RenameSettings,
  apiKey: string
): Promise<string> {
  const request = buildTextRequest(
    settings.llmProvider,
    effectiveModel(settings),
    apiKey,
    content,
    settings.renameMaxFilenameLength
  );
  const raw = await sendRequest(settings.llmProvider, request);
  return extractModelFilename(raw);
}

export async function generateImageRenameFilename(
  base64Image: string,
  mimeType: string,
  settings: RenameSettings,
  apiKey: string
): Promise<string> {
  const request = buildImageRequest(
    settings.llmProvider,
    effectiveModel(settings),
    apiKey,
    base64Image,
    mimeType,
    settings.renameMaxFilenameLength
  );
  const raw = await sendRequest(settings.llmProvider, request);
  return extractModelFilename(raw);
}
