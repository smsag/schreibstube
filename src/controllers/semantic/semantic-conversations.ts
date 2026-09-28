import type { Plugin } from "obsidian";
import type { Logger } from "../../services/logger";
import { ConversationIndex, type ScoredId } from "../../services/semantic/conversation-index";
import {
  normalizeConversations,
  type ConversationItem
} from "../../services/semantic/conversation-source";
import {
  matchConversationTitles,
  mergeConversationResults,
  type ConversationResult
} from "../../services/semantic/conversation-search";
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
  /**
   * Whether the model may be loaded now for work nobody is waiting on. False
   * on a phone, which reads the desktop's index rather than building one, and
   * while the vault index is being built.
   */
  mayEmbedInBackground?(): boolean;
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
  /** Each conversation's attached notes, from the same listing as its title. */
  private attached = new Map<string, readonly string[]>();
  /** A background sync started by the Recommended panel is running. */
  private catchingUp = false;

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
    this.attached.clear();
  }

  isSyncing(): boolean {
    return this.index?.isSyncing() ?? false;
  }

  /** The title the source gave, or null while it has not been listed or
   *  when the source gave none. */
  titleOf(id: string): string | null {
    return this.titles.get(id)?.trim() || null;
  }

  /** Forget the index: the model changed, or search by meaning was switched off. */
  reset(): void {
    this.index = null;
    this.indexModel = null;
    this.dirty = true;
  }

  /**
   * The index, brought up to date with the source first when `embed` allows.
   *
   * Without it — the Recommended panel, which promises not to load the model —
   * the stored index answers as it is, and the next search syncs it. Loading
   * the model to embed one changed chat message on every note switch cost a
   * phone several hundred megabytes it had just released.
   */
  private async ready(embed = true): Promise<ConversationIndex | null> {
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
      this.index = new ConversationIndex(this.host.provider(), files, hashPolicyFor(modelId));
      this.indexModel = modelId;
      this.dirty = true;
    }
    if (!embed) {
      await this.index.loadStored();
      return this.index;
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
        this.remember(items);
        // No explicit load: the sync loads the model only if it has something
        // to embed.
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

  /** The floor a conversation clears to be recommended beside a note: measured
   *  note against conversation, which scores lower than conversation against
   *  conversation (`conversationFloors`). */
  private noteFloor(): number {
    return embeddingModelConfig(this.host.modelId()).conversationFloors[DEFAULT_SIMILARITY_PRESET];
  }

  /** The model's measured floor for "alike", at the balanced preset (Pythia ADR-169). */
  private relatedFloor(): number {
    return embeddingModelConfig(this.host.modelId()).relatedFloors[DEFAULT_SIMILARITY_PRESET];
  }

  /**
   * The titles, listed from the source without touching the index.
   *
   * The Recommended panel reads the stored index and never syncs it — that
   * would load the model — and titles used to arrive only with a sync, so its
   * conversation cards read as their ids. Listing is the source's own cheap
   * answer; it leaves the index to the next search.
   */
  private async loadTitles(): Promise<void> {
    const source = this.source;
    if (!source || (this.titles.size > 0 && !this.dirty)) return;
    const listed = await withTimeout(
      Promise.resolve(source.list()),
      LIST_DEADLINE_MS,
      (s) => `the conversation source did not answer within ${s} s`
    );
    this.remember(normalizeConversations(listed));
  }

  /** What a listing says besides the text: each conversation's title and notes. */
  private remember(items: readonly ConversationItem[]): void {
    this.titles = new Map(items.map((item) => [item.id, item.title]));
    this.attached = new Map(
      items.filter((item) => item.notes.length > 0).map((item) => [item.id, item.notes])
    );
  }

  /**
   * The conversations that had `path` attached as context, most recently
   * listed first. From the last listing; nothing is embedded or read.
   */
  attachedTo(path: string): string[] {
    const ids: string[] = [];
    for (const [id, notes] of this.attached) if (notes.includes(path)) ids.push(id);
    return ids;
  }

  /** Conversations like a note, from its stored vectors. */
  async relatedToVectors(chunks: readonly Int8Array[], limit: number): Promise<ScoredId[]> {
    const index = await this.ready(false);
    if (!index) return [];
    await this.loadTitles().catch((e: unknown) => {
      this.host.logger.warn("semantic engine: conversation titles could not be listed", e);
    });
    // A note's sections against a conversation's chunks, at the floor measured
    // for that comparison.
    const found = index.relatedToVectors(chunks, { minScore: this.noteFloor(), limit });
    this.catchUpInBackground();
    return found;
  }

  /**
   * Bring the stored conversations up to date, without anyone waiting on it.
   *
   * The Recommended panel answers from what is stored and never syncs — a sync
   * may load the model — so a conversation held there only once the Explorer's
   * filter had searched conversations. Everything said in Pythia since the
   * last such search was missing from every note's recommendations. Where the
   * model may run, the panel's answer now also starts the sync it skipped, and
   * the next answer holds what it added.
   */
  private catchUpInBackground(): void {
    if (!this.dirty || this.catchingUp || this.host.mayEmbedInBackground?.() !== true) return;
    this.catchingUp = true;
    this.ready(true)
      .catch((e: unknown) => {
        this.host.logger.warn("semantic engine: conversations could not be brought up to date", e);
      })
      .finally(() => {
        this.catchingUp = false;
      });
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

  /**
   * Conversations for what was typed into the Explorer filter: by the words of
   * their title, then by meaning. A meaning search that fails still leaves the
   * titles, which the listing it started has just brought up to date.
   */
  async find(text: string, limit: number): Promise<ConversationResult[]> {
    let byMeaning: ScoredId[] = [];
    try {
      byMeaning = await this.search(text, limit, []);
    } catch (e) {
      this.host.logger.warn("semantic engine: conversations could not be searched by meaning", e);
    }
    const known = [...this.titles].map(([id, title]) => ({ id, title }));
    return mergeConversationResults(
      matchConversationTitles(text, known),
      byMeaning.flatMap((hit) => {
        const title = this.titleOf(hit.id);
        return title === null ? [] : [{ id: hit.id, title }];
      }),
      limit
    );
  }

  /** Conversations that answer `text`, best first. */
  async search(text: string, limit: number, exclude: Iterable<string>): Promise<ScoredId[]> {
    const index = await this.ready();
    if (!index) return [];
    return index.query(text, { minScore: QUERY_MIN_SCORE, limit, exclude });
  }
}
