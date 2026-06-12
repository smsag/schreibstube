import type { SchreibstubeSettings } from "../types";

type RenameSettings = Pick<
  SchreibstubeSettings,
  "renameProvider" | "renameModel" | "renameMaxFilenameLength"
>;

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

export async function generateRenameFilename(
  content: string,
  settings: RenameSettings,
  apiKey: string
): Promise<string> {
  const systemPrompt = TEXT_SYSTEM_PROMPT.replace(
    "{maxLength}",
    String(settings.renameMaxFilenameLength)
  );
  const userMessage = USER_PROMPT_PREFIX + content;

  switch (settings.renameProvider) {
    case "anthropic":
      return callAnthropic(userMessage, settings.renameModel, systemPrompt, apiKey);
    case "openai":
      return callOpenAI(userMessage, settings.renameModel, systemPrompt, apiKey);
    case "google":
      return callGoogle(userMessage, settings.renameModel, systemPrompt, apiKey);
  }
}

export async function generateImageRenameFilename(
  base64Image: string,
  mimeType: string,
  settings: RenameSettings,
  apiKey: string
): Promise<string> {
  const systemPrompt = IMAGE_SYSTEM_PROMPT.replace(
    "{maxLength}",
    String(settings.renameMaxFilenameLength)
  );

  switch (settings.renameProvider) {
    case "anthropic":
      return callAnthropicImage(base64Image, mimeType, settings.renameModel, systemPrompt, apiKey);
    case "openai":
      return callOpenAIImage(base64Image, mimeType, settings.renameModel, systemPrompt, apiKey);
    case "google":
      return callGoogleImage(base64Image, mimeType, settings.renameModel, systemPrompt, apiKey);
  }
}

async function callAnthropic(
  userMessage: string,
  model: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API error: ${response.status} ${body}`);
  }

  const data = await response.json() as { content?: { text?: string }[] };
  return data.content?.[0]?.text?.trim() ?? "";
}

async function callOpenAI(
  userMessage: string,
  model: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI API error: ${response.status} ${body}`);
  }

  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callGoogle(
  userMessage: string,
  model: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 50 },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google API error: ${response.status} ${body}`);
  }

  const data = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

async function callAnthropicImage(
  base64Image: string,
  mimeType: string,
  model: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
          { type: "text", text: IMAGE_USER_PROMPT },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API error: ${response.status} ${body}`);
  }
  const data = await response.json() as { content?: { text?: string }[] };
  return data.content?.[0]?.text?.trim() ?? "";
}

async function callOpenAIImage(
  base64Image: string,
  mimeType: string,
  model: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "low" } },
            { type: "text", text: IMAGE_USER_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI API error: ${response.status} ${body}`);
  }
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callGoogleImage(
  base64Image: string,
  mimeType: string,
  model: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Image } },
          { text: IMAGE_USER_PROMPT },
        ],
      }],
      generationConfig: { maxOutputTokens: 50 },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google API error: ${response.status} ${body}`);
  }
  const data = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

