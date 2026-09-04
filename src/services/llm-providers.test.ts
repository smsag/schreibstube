import { describe, expect, it } from "vitest";
import {
  LLM_PROVIDER_IDS,
  PROVIDER_MODELS,
  buildImageRequest,
  buildSummaryRequest,
  buildTextRequest,
  describeApiError,
  effectiveModel,
  extractModelFilename,
  parseResponse,
  providerLabel,
  sanitizeFilename
} from "./llm-providers";

describe("sanitizeFilename", () => {
  it("returns clean input unchanged", () => {
    expect(sanitizeFilename("my-note-title", 60)).toBe("my-note-title");
  });

  it("strips illegal characters", () => {
    expect(sanitizeFilename('note: with/slashes*and?questions"', 60)).toBe(
      "note-withslashesandquestions"
    );
  });

  it("converts whitespace to hyphens", () => {
    expect(sanitizeFilename("my note title", 60)).toBe("my-note-title");
  });

  it("collapses multiple hyphens", () => {
    expect(sanitizeFilename("my--note---title", 60)).toBe("my-note-title");
  });

  it("trims leading and trailing hyphens", () => {
    expect(sanitizeFilename("-my-note-", 60)).toBe("my-note");
  });

  it("trims leading and trailing dots", () => {
    expect(sanitizeFilename("...my-note...", 60)).toBe("my-note");
  });

  it("truncates to maxLength", () => {
    expect(sanitizeFilename("a-very-long-filename-that-exceeds-the-limit", 10)).toHaveLength(10);
  });

  it("removes trailing hyphen introduced by truncation", () => {
    expect(sanitizeFilename("hello-world", 6)).toBe("hello");
  });

  it("returns empty string for all-illegal input", () => {
    expect(sanitizeFilename("///***???", 60)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeFilename("", 60)).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeFilename("   ", 60)).toBe("");
  });
});

describe("extractModelFilename", () => {
  it("returns a plain filename unchanged", () => {
    expect(extractModelFilename("my-note-title")).toBe("my-note-title");
  });

  it("strips surrounding quotes", () => {
    expect(extractModelFilename('"my-note-title"')).toBe("my-note-title");
  });

  it("strips a code fence", () => {
    expect(extractModelFilename("```\nmy-note-title\n```")).toBe("my-note-title");
  });

  it("strips a labelled prefix", () => {
    expect(extractModelFilename("Filename: my-note-title")).toBe("my-note-title");
  });

  it("takes the first non-empty line", () => {
    expect(extractModelFilename("\n\nmy-note-title\nsome explanation")).toBe("my-note-title");
  });

  it("handles empty input", () => {
    expect(extractModelFilename("")).toBe("");
  });
});

describe("describeApiError", () => {
  it("maps 401 to an API-key message", () => {
    expect(describeApiError("Anthropic", 401, "")).toMatch(/API key/i);
  });

  it("maps 429 to a rate-limit message", () => {
    expect(describeApiError("OpenAI", 429, "")).toMatch(/rate limited/i);
  });

  it("maps 5xx to a service-error message", () => {
    expect(describeApiError("OpenAI", 503, "")).toMatch(/service error/i);
  });

  it("extracts a nested error.message from the body", () => {
    const body = JSON.stringify({ error: { message: "bad model" } });
    expect(describeApiError("OpenAI", 400, body)).toContain("bad model");
  });

  it("falls back to raw body when not JSON", () => {
    expect(describeApiError("OpenAI", 400, "plain text failure")).toContain("plain text failure");
  });
});

describe("effectiveModel", () => {
  it("uses the dropdown model when no custom value", () => {
    expect(effectiveModel({ llmModel: "gpt-4o", llmModelCustom: "" })).toBe("gpt-4o");
  });

  it("prefers a non-empty custom model", () => {
    expect(effectiveModel({ llmModel: "gpt-4o", llmModelCustom: "gpt-5-mini" })).toBe("gpt-5-mini");
  });

  it("ignores a whitespace-only custom model", () => {
    expect(effectiveModel({ llmModel: "gpt-4o", llmModelCustom: "   " })).toBe("gpt-4o");
  });
});

describe("provider registry", () => {
  it("exposes exactly anthropic and openai", () => {
    expect([...LLM_PROVIDER_IDS].sort()).toEqual(["anthropic", "openai"]);
  });

  it("has no google/gemini entries", () => {
    expect(JSON.stringify(PROVIDER_MODELS)).not.toMatch(/google|gemini/i);
  });

  it("labels each provider", () => {
    expect(providerLabel("anthropic")).toBe("Anthropic");
    expect(providerLabel("openai")).toBe("OpenAI");
  });
});

describe("buildTextRequest", () => {
  it("targets the Anthropic endpoint with the api-key header and model in the body", () => {
    const req = buildTextRequest("anthropic", "claude-x", "sk-test", "hello", 60);
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-test");
    const body = JSON.parse(req.body);
    expect(body.model).toBe("claude-x");
    expect(body.system).toContain("60");
    expect(body.messages[0].content).toContain("hello");
  });

  it("targets the OpenAI endpoint with a bearer token and a system message", () => {
    const req = buildTextRequest("openai", "gpt-x", "sk-test", "hello", 42);
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(req.body);
    expect(body.model).toBe("gpt-x");
    expect(body.messages[0].role).toBe("system");
  });
});

describe("buildSummaryRequest", () => {
  it("sends the prompt verbatim as the Anthropic system and the text as the user message", () => {
    const req = buildSummaryRequest("anthropic", "claude-x", "sk-test", "Be concise.", "raw text", 512);
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-test");
    const body = JSON.parse(req.body);
    expect(body.model).toBe("claude-x");
    expect(body.system).toBe("Be concise.");
    expect(body.max_tokens).toBe(512);
    expect(body.messages[0].content).toBe("raw text");
  });

  it("uses the caller's token cap and a system message for OpenAI", () => {
    const req = buildSummaryRequest("openai", "gpt-x", "sk-test", "Be concise.", "raw text", 256);
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(req.body);
    expect(body.max_tokens).toBe(256);
    expect(body.messages[0]).toEqual({ role: "system", content: "Be concise." });
    expect(body.messages[1]).toEqual({ role: "user", content: "raw text" });
  });
});

describe("buildImageRequest", () => {
  it("embeds an Anthropic base64 image block", () => {
    const req = buildImageRequest("anthropic", "claude-x", "sk", "AAAA", "image/png", 60);
    const body = JSON.parse(req.body);
    expect(body.messages[0].content[0].source.data).toBe("AAAA");
    expect(body.messages[0].content[0].source.media_type).toBe("image/png");
  });

  it("embeds an OpenAI data-url image block", () => {
    const req = buildImageRequest("openai", "gpt-x", "sk", "AAAA", "image/png", 60);
    const body = JSON.parse(req.body);
    expect(body.messages[1].content[0].image_url.url).toBe("data:image/png;base64,AAAA");
  });
});

describe("parseResponse", () => {
  it("reads Anthropic content", () => {
    expect(parseResponse("anthropic", { content: [{ text: "  name  " }] })).toBe("  name  ");
  });

  it("reads OpenAI content", () => {
    expect(parseResponse("openai", { choices: [{ message: { content: "name" } }] })).toBe("name");
  });

  it("returns empty string for a malformed response", () => {
    expect(parseResponse("openai", {})).toBe("");
  });
});
