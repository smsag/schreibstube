import { t } from "../../i18n";
import type { Logger } from "../../services/logger";
import type { RetrievedNote } from "../../services/semantic/vault-retrieval";
import {
  SEMANTIC_API_VERSION,
  clampLimit,
  itemKey,
  mergeHits,
  publicItemId,
  readExclude,
  readNames,
  readPublicItemId,
  readQuery,
  readSource,
  readSourceId,
  relevance,
  splitItemKey,
  wants,
  type Hit,
  type RelatedRef,
  type SchreibstubeSemanticApi,
  type SearchStatus
} from "../../services/semantic/semantic-api";
import type { RelatedFound, SemanticEngine } from "./semantic-engine";
import type { ScoredKey } from "./semantic-sources";

export interface SemanticApiDeps {
  engine: SemanticEngine;
  logger: Logger;
  /** What a vault path is as a hit: a picture for a description note, a note
   *  otherwise, or null for a path that is no longer a file. */
  vaultHit(path: string): { kind: "note" | "image"; id: string; title: string } | null;
  /** Whether a name is in Schreibstube's icon set. */
  isIcon(name: string): boolean;
  /** Whether an enabled plugin has this id: null when that cannot be told. */
  pluginPresent(id: string): boolean | null;
}

/**
 * The API as an object other plugins hold. Wiring only: every argument goes
 * through the checks in `services/semantic/semantic-api`, and every failure
 * inside a question is logged and answered with nothing, so a caller's bad day
 * never becomes an exception thrown into another plugin's code. Registering
 * throws, since a caller that got it wrong has to be told.
 */
export function createSemanticApi(deps: SemanticApiDeps): SchreibstubeSemanticApi {
  const { engine, logger } = deps;

  const vaultHits = (
    found: readonly RetrievedNote[],
    floor: number,
    kinds: Set<string> | null,
    exclude: Set<string>
  ): Hit[] => {
    const hits: Hit[] = [];
    const seen = new Set<string>();
    for (const note of found) {
      const hit = deps.vaultHit(note.id);
      if (!hit || !wants(kinds, hit.kind) || exclude.has(hit.id) || seen.has(hit.id)) continue;
      seen.add(hit.id);
      hits.push({ ...hit, score: relevance(note.score, floor), similarity: note.score });
    }
    return hits;
  };

  const itemHits = (found: readonly ScoredKey[], floor: number, kinds: Set<string> | null): Hit[] =>
    found.flatMap((hit) => {
      const parts = splitItemKey(hit.key);
      const kind = parts ? engine.sources.descriptorOf(parts.source)?.kind : undefined;
      if (!parts || !kind || !wants(kinds, kind)) return [];
      return [
        {
          kind,
          id: publicItemId(parts.source, parts.item),
          title: engine.sources.titleOf(hit.key) ?? parts.item,
          score: relevance(hit.score, floor),
          similarity: hit.score,
          source: parts.source,
          item: parts.item
        }
      ];
    });

  /** Whether the vault can answer this question at all, and the sources that may. */
  const scope = (opts: { kinds?: unknown; sources?: unknown } | undefined) => {
    const kinds = readNames(opts?.kinds);
    const sources = readNames(opts?.sources);
    const vault = wants(kinds, "note") || wants(kinds, "image");
    const items =
      kinds === null || engine.sources.kinds().some((k) => kinds.has(k.descriptor.kind));
    return { kinds, sources, vault, items };
  };

  const merged = (
    found: RelatedFound,
    s: ReturnType<typeof scope>,
    limit: number,
    exclude: Set<string>
  ): Hit[] =>
    mergeHits(
      [
        s.vault ? vaultHits(found.notes, found.notesFloor, s.kinds, exclude) : [],
        s.items ? itemHits(found.items, found.itemsFloor, s.kinds) : []
      ],
      limit
    );

  return {
    version: SEMANTIC_API_VERSION,

    status(): SearchStatus {
      if (!engine.enabled()) return "off";
      const state = engine.searchState();
      return state === "none" ? "loading" : state;
    },

    kinds() {
      if (!engine.enabled()) return [];
      return [
        { kind: "note", label: t().semantic.sources.noteKind, source: null },
        { kind: "image", label: t().semantic.sources.imageKind, source: null },
        ...engine.sources.kinds().map(({ source, descriptor }) => ({
          kind: descriptor.kind,
          label: descriptor.plural,
          source
        }))
      ];
    },

    async search(text, opts) {
      const query = readQuery(text);
      if (query.length === 0) return [];
      const limit = clampLimit(opts?.limit);
      const exclude = readExclude(opts?.exclude);
      const s = scope(opts);
      // Excluded items reach the sources as keys; excluded paths the vault.
      const excludeKeys = new Set(
        [...exclude].flatMap((id) => {
          const parts = readPublicItemId(id);
          return parts ? [itemKey(parts.source, parts.item)] : [];
        })
      );
      try {
        // One embed of the query for the vault and every source.
        const found = await engine.searchAll(query, {
          notes: s.vault ? limit + exclude.size : 0,
          items: s.items ? limit : 0,
          exclude: excludeKeys,
          sources: s.sources
        });
        return merged(found, s, limit, exclude);
      } catch (e) {
        logger.warn("semantic API: search failed", e);
        return [];
      }
    },

    async related(ref: RelatedRef, opts) {
      if (typeof ref !== "object" || ref === null) return [];
      const limit = clampLimit(opts?.limit);
      const s = scope(opts);
      try {
        if ("path" in ref && typeof ref.path === "string") {
          const found = await engine.relatedToNote(ref.path, limit, s.sources);
          return merged(found, s, limit, new Set([ref.path]));
        }
        if ("source" in ref && typeof ref.id === "string") {
          const source = readSourceId(ref.source);
          if (!source) return [];
          const found = await engine.relatedToItem(itemKey(source, ref.id), limit, s.sources);
          return merged(found, s, limit, new Set());
        }
        return [];
      } catch (e) {
        logger.warn("semantic API: related failed", e);
        return [];
      }
    },

    registerSource(sourceId, source) {
      const id = readSourceId(sourceId);
      if (!id) throw new Error(`Schreibstube: "${String(sourceId)}" is not a plugin id`);
      if (deps.pluginPresent(id) === false) {
        throw new Error(`Schreibstube: no enabled plugin is called "${id}"`);
      }
      const read = readSource(source, deps.isIcon);
      if ("problem" in read) throw new Error(`Schreibstube: ${read.problem}`);
      return engine.sources.register(id, read.source, read.descriptor);
    },

    onIndexChanged: (cb) => {
      if (typeof cb !== "function") return () => undefined;
      return engine.onContentChange(() => cb());
    }
  };
}
