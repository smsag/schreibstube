/**
 * The request side of a proof-read run: binds the wire protocol in
 * proofread-protocol to the user's configured provider, model, and API key.
 */

import type { SchreibstubeSettings } from "../types";
import { sendRequest } from "./llm-client";
import type { TermConstraint } from "./glossary-matcher";
import { buildSummaryRequest, effectiveModel } from "./llm-providers";
import type { ProseBlock } from "./markdown-segments";
import {
  buildProofreadSystemPrompt,
  encodeChunk,
  parseChunkResponse,
  tokensForChunk
} from "./proofread-protocol";
import type { CancelToken, ChunkSender } from "./proofread-runner";

export type ProofreadSettings = Pick<
  SchreibstubeSettings,
  "llmProvider" | "llmModel" | "llmModelCustom" | "proofreadPrompt" | "proofreadMaxTokens"
>;

/** Build the sender the runner drives, bound to the user's provider and key. */
export function createChunkSender(
  settings: ProofreadSettings,
  apiKey: string,
  constraints: TermConstraint[] = []
): ChunkSender {
  const systemPrompt = buildProofreadSystemPrompt(settings.proofreadPrompt, constraints);

  return async (blocks: ProseBlock[], token: CancelToken) => {
    const request = buildSummaryRequest(
      settings.llmProvider,
      effectiveModel(settings),
      apiKey,
      systemPrompt,
      encodeChunk(blocks),
      tokensForChunk(blocks, settings.proofreadMaxTokens)
    );

    const response = await sendRequest(settings.llmProvider, request);
    // A cancelled run throws its result away rather than producing cards the
    // user has already said they do not want.
    if (token.cancelled) {
      return new Map<string, string>();
    }

    return parseChunkResponse(response, blocks);
  };
}
