import type { Plugin } from "obsidian";
import type { Logger } from "../../services/logger";
import { ConversationIndex, type ScoredId } from "../../services/semantic/conversation-index";
import { normalizeConversations } from "../../services/semantic/conversation-source";
import {
  DEFAULT_SIMILARITY_PRESET,
  embeddingModelConfig,
  type EmbeddingModelId
} from "../../services/semantic/embedding-models";
import type { EmbeddingProvider } from "../../services/semantic/embedding-provider";
import { hashPolicyFor } from "../../services/semantic/row-provenance";
import type { ConversationSource } from "../../services/semantic/semantic-api";
import { withTimeout } from "../../utils/with-timeout";
import { SemanticIndexFiles } from "./index-files";

/** How long a source may take to list its conversations. It is another
 *  plugin's code; a list that never comes must not hold a search forever. */
const LIST_DEADLINE_MS = 5000;

/** The floor a conversation must clear to answer a typed text. The vault
 *  retrieval floor, since it is the same comparison: a query against chunks. */
const QUERY_MIN_SCORE = 0.35;

export interface ConversationHost {
  plugin: Plugin;
  logger: Logger;
  /** Whether search by meaning may run here now. */
  enabled(): boolean;
  modelId(): EmbeddingModelId;
  /** The engine's one model: never a second one. */
  provider(): EmbeddingProvider;
  /** Something changed that a caller may want to redraw for. */
  changed(): void;
}

/**
 * The conversations a source hands over, indexed with the engine's model.
 *
 * The source is asked for its list only when a question needs it and it said
 * something changed, so a chat plugin that saves after every message costs
 * nothing until someone searches. Pythia's own index is taken over once when
 * this vault has none, so its conversations do not have to be read again.
 */
export class SemanticConversations {
  private source: ConversationSource | null = null;
  private unsubscribe: (() => void) | null = null;
  private index: ConversationIndex | null = null;
  private indexModel: EmbeddingModelId | null = null;
  private dirty = true;
  private titles = new Map<string, string>();

  constructor(private readonly host: ConversationHost) {}

  /** Take a source; the previous one, if any, is let go. Returns the release. */
  register(source: ConversationSource): () => void {
    this.release();
    this.source = source;
    this.dirty = true;
    this.unsubscribe = source.onChanged(() => {
      this.dirty = true;
    });
    return () => {
      if (this.source === source) this.release();
    };
  }

  private release(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.source = null;
    this.titles.clear();
  }

  isSyncing(): boolean {
    return this.index?.isSyncing() ?? false;
  }

  titleOf(id: string): string {
    return this.titles.get(id) ?? id;
  }

  /** Forget the index: the model changed, or search by meaning was switched off. */
  reset(): void {
    this.index = null;
    this.indexModel = null;
    this.dirty = true;
  }

  private async ready(): Promise<ConversationIndex | null> {
    const source = this.source;
    if (!source || !this.host.enabled()) return null;
    const modelId = this.host.modelId();
    if (!this.index || this.indexModel !== modelId) {
      const files = new SemanticIndexFiles(
        this.host.plugin,
        modelId,
        ".bin",
        "semantic-conversations"
      );
      try {
        if (await files.importFromPythia()) {
          this.host.logger.info("semantic engine: imported Pythia's conversation index");
        }
      } catch (e) {
        this.host.logger.warn("semantic engine: could not import Pythia's conversation index", e);
      }
      this.index = new ConversationIndex(this.host.provider(), files, hashPolicyFor(modelId));
      this.indexModel = modelId;
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      try {
        const listed = await withTimeout(
          Promise.resolve(source.list()),
          LIST_DEADLINE_MS,
          (s) => `the conversation source did not answer within ${s} s`
        );
        const items = normalizeConversations(listed);
        this.titles = new Map(items.map((item) => [item.id, item.title]));
        await this.host.provider().ready();
        await this.index.sync(items);
        this.host.changed();
      } catch (e) {
        this.dirty = true;
        throw e;
      }
    }
    return this.index;
  }

  /** Conversations like `id`, most alike first. */
  async related(id: string, limit: number): Promise<ScoredId[]> {
    const index = await this.ready();
    if (!index) return [];
    return index.related(id, { minScore: this.relatedFloor(), limit });
  }

  /** The model's measured floor for "alike", at the balanced preset (Pythia ADR-169). */
  private relatedFloor(): number {
    return embeddingModelConfig(this.host.modelId()).relatedFloors[DEFAULT_SIMILARITY_PRESET];
  }

  /** Conversations like a note, from its stored vectors. */
  async relatedToVectors(chunks: readonly Int8Array[], limit: number): Promise<ScoredId[]> {
    const index = await this.ready();
    if (!index) return [];
    // Chunk against chunk, the comparison the related floors were measured on.
    return index.relatedToVectors(chunks, { minScore: this.relatedFloor(), limit });
  }

  /** Open a conversation in the plugin that listed it, if it can. */
  open(id: string): boolean {
    const source = this.source;
    if (!source?.open) return false;
    try {
      source.open(id);
      return true;
    } catch (e) {
      this.host.logger.warn("semantic engine: the source could not open a conversation", e);
      return false;
    }
  }

  /** Conversations that answer `text`, best first. */
  async search(text: string, limit: number, exclude: Iterable<string>): Promise<ScoredId[]> {
    const index = await this.ready();
    if (!index) return [];
    return index.query(text, { minScore: QUERY_MIN_SCORE, limit, exclude });
  }
}
