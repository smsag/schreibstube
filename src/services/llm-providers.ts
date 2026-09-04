import type { LlmProvider, SchreibstubeSettings } from "../types";

/** Max tokens requested for a filename completion. Filenames are short, but
 *  leave headroom so a descriptive name is never cut mid-word. */
export const MAX_TOKENS = 64;

/** How long to wait for a provider response before giving up. */
export const REQUEST_TIMEOUT_MS = 30_000;

const TEXT_SYSTEM_PROMPT =
  `You are a file naming assistant. Given the content of a Markdown note, ` +
  `respond with a concise, descriptive filename. Rules:\n` +
  `- No file extension\n` +
  `- No path separators\n` +
  `- Use lowercase words separated by hyphens\n` +
  `- Maximum {maxLength} characters\n` +
  `- Respond with the filename only — nothing else`;

const IMAGE_SYSTEM_PROMPT =
  `You are a file naming assistant. Given an image, ` +
  `respond with a concise, descriptive filename. Rules:\n` +
  `- No file extension\n` +
  `- No path separators\n` +
  `- Use lowercase words separated by hyphens\n` +
  `- Maximum {maxLength} characters\n` +
  `- Respond with the filename only — nothing else`;

const IMAGE_USER_PROMPT = "Please suggest a filename for this image.";
const USER_PROMPT_PREFIX = "Please suggest a filename for this note:\n\n";

export interface ProviderModel {
  label: string;
  value: string;
}

interface ProviderAdapter {
  label: string;
  models: ProviderModel[];
  url: string;
  headers(apiKey: string): Record<string, string>;
  textBody(model: string, systemPrompt: string, userMessage: string, maxTokens: number): unknown;
  imageBody(model: string, systemPrompt: string, base64Image: string, mimeType: string): unknown;
  parse(json: unknown): string;
}

const ANTHROPIC: ProviderAdapter = {
  label: "Anthropic",
  models: [
    { label: "Claude Haiku 4.5 (recommended)", value: "claude-haiku-4-5-20251001" },
    { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" }
  ],
  url: "https://api.anthropic.com/v1/messages",
  headers: (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  }),
  textBody: (model, systemPrompt, userMessage, maxTokens) => ({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }]
  }),
  imageBody: (model, systemPrompt, base64Image, mimeType) => ({
    model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
          { type: "text", text: IMAGE_USER_PROMPT }
        ]
      }
    ]
  }),
  parse: (json) =>
    (json as { content?: { text?: string }[] })?.content?.[0]?.text ?? ""
};

const OPENAI: ProviderAdapter = {
  label: "OpenAI",
  models: [
    { label: "GPT-4o mini (recommended)", value: "gpt-4o-mini" },
    { label: "GPT-4o", value: "gpt-4o" }
  ],
  url: "https://api.openai.com/v1/chat/completions",
  headers: (apiKey) => ({
    "Authorization": `Bearer ${apiKey}`,
    "content-type": "application/json"
  }),
  textBody: (model, systemPrompt, userMessage, maxTokens) => ({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ]
  }),
  imageBody: (model, systemPrompt, base64Image, mimeType) => ({
    model,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "low" } },
          { type: "text", text: IMAGE_USER_PROMPT }
        ]
      }
    ]
  }),
  parse: (json) =>
    (json as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? ""
};

/** The single source of truth for provider integration. Add or remove a
 *  provider here and the type union stays the only other place to update. */
export const LLM_PROVIDERS: Record<LlmProvider, ProviderAdapter> = {
  anthropic: ANTHROPIC,
  openai: OPENAI
};

export const LLM_PROVIDER_IDS = Object.keys(LLM_PROVIDERS) as LlmProvider[];

export const PROVIDER_MODELS: Record<LlmProvider, ProviderModel[]> = Object.fromEntries(
  LLM_PROVIDER_IDS.map((id) => [id, LLM_PROVIDERS[id].models])
) as Record<LlmProvider, ProviderModel[]>;

export function providerLabel(provider: LlmProvider): string {
  return LLM_PROVIDERS[provider].label;
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function withMaxLength(template: string, maxFilenameLength: number): string {
  return template.replace("{maxLength}", String(maxFilenameLength));
}

export function buildTextRequest(
  provider: LlmProvider,
  model: string,
  apiKey: string,
  content: string,
  maxFilenameLength: number
): BuiltRequest {
  const adapter = LLM_PROVIDERS[provider];
  const systemPrompt = withMaxLength(TEXT_SYSTEM_PROMPT, maxFilenameLength);
  return {
    url: adapter.url,
    headers: adapter.headers(apiKey),
    body: JSON.stringify(adapter.textBody(model, systemPrompt, USER_PROMPT_PREFIX + content, MAX_TOKENS))
  };
}

/** Build a request that sends the given text under a caller-supplied system
 *  prompt. Unlike {@link buildTextRequest}, the prompt is used verbatim (no
 *  filename templating) and the token cap is caller-controlled, so longer
 *  free-form completions such as summaries are possible. */
export function buildSummaryRequest(
  provider: LlmProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  content: string,
  maxTokens: number
): BuiltRequest {
  const adapter = LLM_PROVIDERS[provider];
  return {
    url: adapter.url,
    headers: adapter.headers(apiKey),
    body: JSON.stringify(adapter.textBody(model, systemPrompt, content, maxTokens))
  };
}

export function buildImageRequest(
  provider: LlmProvider,
  model: string,
  apiKey: string,
  base64Image: string,
  mimeType: string,
  maxFilenameLength: number
): BuiltRequest {
  const adapter = LLM_PROVIDERS[provider];
  const systemPrompt = withMaxLength(IMAGE_SYSTEM_PROMPT, maxFilenameLength);
  return {
    url: adapter.url,
    headers: adapter.headers(apiKey),
    body: JSON.stringify(adapter.imageBody(model, systemPrompt, base64Image, mimeType))
  };
}

export function parseResponse(provider: LlmProvider, json: unknown): string {
  return LLM_PROVIDERS[provider].parse(json);
}

/** Resolve the model to use: a non-empty custom override wins over the
 *  dropdown selection. */
export function effectiveModel(
  settings: Pick<SchreibstubeSettings, "renameModel" | "renameModelCustom">
): string {
  const custom = settings.renameModelCustom?.trim();
  return custom ? custom : settings.renameModel;
}

const ILLEGAL_CHARS = /[/\\:*?"<>|#^[\]]/g;
const MULTIPLE_HYPHENS = /-{2,}/g;
const WHITESPACE = /\s+/g;
const EDGE_DOTS_HYPHENS = /^[.\-]+|[.\-]+$/g;

export function sanitizeFilename(raw: string, maxLength: number): string {
  return raw
    .trim()
    .replace(ILLEGAL_CHARS, "")
    .replace(WHITESPACE, "-")
    .replace(MULTIPLE_HYPHENS, "-")
    .replace(EDGE_DOTS_HYPHENS, "")
    .slice(0, maxLength)
    .replace(EDGE_DOTS_HYPHENS, "");
}

/** Models don't always obey "filename only" — they may wrap the answer in a
 *  code fence, quotes, or a "Filename:" label. Recover the bare candidate
 *  before it is sanitized. */
export function extractModelFilename(raw: string): string {
  let text = (raw ?? "").trim();

  if (text.startsWith("```")) {
    text = text.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }

  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "";

  return firstLine
    .replace(/^(?:file\s*name|filename|name)\s*[:=]\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

/** Turn a failed API response into a short, actionable message. */
export function describeApiError(providerName: string, status: number, body: string): string {
  const detail = extractApiMessage(body);

  if (status === 401 || status === 403) {
    return `${providerName}: authentication failed (${status}). Check your API key.`;
  }
  if (status === 429) {
    return `${providerName}: rate limited (429). Please try again shortly.`;
  }
  if (status >= 500) {
    return `${providerName}: service error (${status}). Please try again later.`;
  }
  return `${providerName} API error ${status}${detail ? `: ${detail}` : ""}`;
}

function extractApiMessage(body: string): string {
  if (!body) {
    return "";
  }
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: string };
      message?: string;
    };
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
    return parsed.error?.message ?? parsed.message ?? "";
  } catch {
    return body.slice(0, 200);
  }
}
