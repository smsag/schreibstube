import type { SchreibstubeSettings } from "../types";
import { buildImageDescriptionRequest, effectiveModel } from "./llm-providers";
import { sendRequest } from "./llm-client";
import {
  DESCRIPTION_MAX_TOKENS,
  DESCRIPTION_USER_PROMPT,
  descriptionSystemPrompt,
  normalizeImageDescription,
  type DescriptionLanguage,
  type ImageDescription
} from "./image-description";

type DescribeSettings = Pick<SchreibstubeSettings, "llmProvider" | "llmModel" | "llmModelCustom">;

/**
 * A picture's description from the configured model, checked, or null when the
 * answer could not vouch for itself. A failed request throws, so the caller can
 * tell "the provider refused" from "the answer was unusable".
 */
export async function generateImageDescription(
  image: { base64: string; mimeType: string },
  language: DescriptionLanguage,
  settings: DescribeSettings,
  apiKey: string
): Promise<ImageDescription | null> {
  const request = buildImageDescriptionRequest(
    settings.llmProvider,
    effectiveModel(settings),
    apiKey,
    image,
    {
      systemPrompt: descriptionSystemPrompt(language),
      userText: DESCRIPTION_USER_PROMPT,
      maxTokens: DESCRIPTION_MAX_TOKENS
    }
  );
  return normalizeImageDescription(await sendRequest(settings.llmProvider, request));
}
