import type { Logger } from "../../services/logger";
import {
  ALLOWED_SOURCES,
  SEMANTIC_API_VERSION,
  clampLimit,
  isConversationSource,
  mergeHits,
  readExclude,
  readKinds,
  type Hit,
  type RelatedRef,
  type SchreibstubeSemanticApi
} from "../../services/semantic/semantic-api";
import type { SemanticEngine } from "./semantic-engine";

export interface SemanticApiDeps {
  engine: SemanticEngine;
  logger: Logger;
  /** What a vault path is as a hit: a picture for a description note, a note
   *  otherwise, or null for a path that is no longer a file. */
  vaultHit(path: string): { kind: "note" | "image"; id: string; title: string } | null;
}

/**
 * The API as an object other plugins hold. Wiring only: every argument goes
 * through the checks in `services/semantic/semantic-api`, and every failure
 * inside is logged and answered with nothing, so a caller's bad day never
 * becomes an exception thrown into another plugin's code.
 */
export function createSemanticApi(deps: SemanticApiDeps): SchreibstubeSemanticApi {
  const { engine, logger } = deps;

  const vaultHits = async (
    text: string,
    limit: number,
    exclude: Set<string>,
    want: Set<string>
  ): Promise<Hit[]> => {
    const found = await engine.search(text, limit + exclude.size);
    const hits: Hit[] = [];
    const seen = new Set<string>();
    for (const note of found) {
      const hit = deps.vaultHit(note.id);
      if (!hit || !want.has(hit.kind) || exclude.has(hit.id) || seen.has(hit.id)) continue;
      seen.add(hit.id);
      hits.push({ ...hit, score: note.score });
    }
    return hits;
  };

  const conversationHits = (found: { id: string; score: number }[]): Hit[] =>
    found.map((hit) => ({
      kind: "conversation",
      id: hit.id,
      title: engine.conversations.titleOf(hit.id),
      score: hit.score
    }));

  return {
    version: SEMANTIC_API_VERSION,

    ready: () => engine.enabled(),

    async search(text, opts) {
      if (typeof text !== "string" || text.trim().length === 0) return [];
      const kinds = readKinds(opts?.kinds);
      const limit = clampLimit(opts?.limit);
      const exclude = readExclude(opts?.exclude);
      try {
        const lists: Hit[][] = [];
        if (kinds.has("note") || kinds.has("image")) {
          lists.push(await vaultHits(text, limit, exclude, kinds));
        }
        if (kinds.has("conversation")) {
          lists.push(conversationHits(await engine.conversations.search(text, limit, exclude)));
        }
        return mergeHits(lists, limit);
      } catch (e) {
        logger.warn("semantic API: search failed", e);
        return [];
      }
    },

    async related(ref: RelatedRef, opts) {
      const kinds = readKinds(opts?.kinds);
      const limit = clampLimit(opts?.limit);
      // Related notes and pictures come with the Recommended strip; until then
      // only a conversation can be asked about.
      if (!kinds.has("conversation") || typeof ref !== "object" || ref === null) return [];
      if (!("source" in ref) || typeof ref.id !== "string") return [];
      try {
        return conversationHits(await engine.conversations.related(ref.id, limit));
      } catch (e) {
        logger.warn("semantic API: related failed", e);
        return [];
      }
    },

    registerSource(pluginId, source) {
      if (!ALLOWED_SOURCES.includes(pluginId)) {
        throw new Error(`Schreibstube: "${pluginId}" may not register a conversation source`);
      }
      if (!isConversationSource(source)) {
        throw new Error("Schreibstube: a conversation source needs list() and onChanged()");
      }
      return engine.conversations.register(source);
    },

    onIndexChanged: (cb) => engine.onChange(() => cb())
  };
}
