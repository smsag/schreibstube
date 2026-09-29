import type { Plugin } from "obsidian";
import type { Logger } from "../../services/logger";
import { ConversationIndex, type ScoredId } from "../../services/semantic/conversation-index";
import {
  MAX_CONVERSATIONS,
  normalizeConversations,
  type ConversationItem
} from "../../services/semantic/conversation-source";
import type { EmbeddingModelId } from "../../services/semantic/embedding-models";
import type { EmbeddingProvider } from "../../services/semantic/embedding-provider";
import { hashPolicyFor } from "../../services/semantic/row-provenance";
import { readLink, type ItemSource } from "../../services/semantic/semantic-api";
import { withTimeout } from "../../utils/with-timeout";
import { SemanticIndexFiles } from "./index-files";

/** How long a source may take to answer. It is another plugin's code; an
 *  answer that never comes must not hold a search forever. */
const LIST_DEADLINE_MS = 5000;

export interface SourceIndexHost {
  plugin: Plugin;
  logger: Logger;
  modelId(): EmbeddingModelId;
  /** The engine's one model: never a second one. */
  provider(): EmbeddingProvider;
  /** What a search can find has changed. */
  changed(): void;
  /**
   * Whether the model may be loaded now for work nobody is waiting on. False
   * on a phone, which reads the desktop's index rather than building one, and
   * while the vault index is being built.
   */
  mayEmbedInBackground(): boolean;
  /** The vector the vault index holds for `text`, so the model reads a query once. */
  queryVector(text: string): Promise<Int8Array | null>;
}

/**
 * One source's items, indexed with the engine's model in a file of its own.
 *
 * The source is asked only when a question needs it and it said something
 * changed, so a plugin that saves after every keystroke costs nothing until
 * someone searches. A source that can say which items changed since a moment
 * is asked for those alone; one that cannot hands over its whole list.
 */
export class SourceIndex {
  private index: ConversationIndex | null = null;
  private indexModel: EmbeddingModelId | null = null;
  private dirty = true;
  private readonly unsubscribe: () => void;
  /** The last listing, by id: what titles, attached notes and an incremental
   *  sync are read from. */
  private items = new Map<string, ConversationItem>();
  private listed = false;
  /** The newest `updatedAt` seen, which an incremental sync asks after. */
  private seenUntil = 0;
  /** A background sync started by the Recommended panel is running. */
  private catchingUp = false;
  /** The sync under way, so a second caller waits for it instead of asking an
   *  index half-way through taking the source's new rows. */
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly host: SourceIndexHost,
    readonly id: string,
    private readonly source: ItemSource
  ) {
    let unsubscribe: unknown;
    try {
      unsubscribe = source.onChanged(() => {
        this.dirty = true;
      });
    } catch (e) {
      host.logger.warn(`semantic sources: ${id} could not be subscribed to`, e);
    }
    this.unsubscribe = typeof unsubscribe === "function" ? (unsubscribe as () => void) : () => {};
  }

  release(): void {
    try {
      this.unsubscribe();
    } catch (e) {
      this.host.logger.warn(`semantic sources: ${this.id} could not be unsubscribed from`, e);
    }
    this.items.clear();
  }

  isSyncing(): boolean {
    return this.index?.isSyncing() ?? false;
  }

  size(): number {
    return this.items.size;
  }

  /** The title the source gave, or null while it has not been listed. */
  titleOf(id: string): string | null {
    return this.items.get(id)?.title.trim() || null;
  }

  /** Every listed item's id and title, for matching typed words against. */
  titles(): { id: string; title: string }[] {
    return [...this.items.values()].map((item) => ({ id: item.id, title: item.title }));
  }

  /** Forget the index: the model changed, or search by meaning was switched off. */
  reset(): void {
    this.index = null;
    this.indexModel = null;
    this.dirty = true;
  }

  /** The items that had `path` attached as context, from the last listing. */
  attachedTo(path: string): string[] {
    const ids: string[] = [];
    for (const item of this.items.values()) if (item.notes.includes(path)) ids.push(item.id);
    return ids;
  }

  private files(modelId: EmbeddingModelId): SemanticIndexFiles {
    return new SemanticIndexFiles(this.host.plugin, modelId, ".bin", `semantic-source-${this.id}`);
  }

  /**
   * The index, brought up to date with the source first when `embed` allows.
   *
   * Without it — the Recommended panel, which promises not to load the model —
   * the stored index answers as it is, and the next search syncs it. Loading
   * the model to embed one changed item on every note switch cost a phone
   * several hundred megabytes it had just released.
   */
  private async ready(embed: boolean): Promise<ConversationIndex> {
    const modelId = this.host.modelId();
    if (!this.index || this.indexModel !== modelId) {
      this.index = new ConversationIndex(
        this.host.provider(),
        this.files(modelId),
        hashPolicyFor(modelId)
      );
      this.indexModel = modelId;
      this.dirty = true;
    }
    if (!embed) {
      await this.index.loadStored();
      return this.index;
    }
    if (this.syncing) {
      await this.syncing;
      return this.index;
    }
    if (this.dirty) {
      this.dirty = false;
      this.syncing = this.syncWith(this.index).finally(() => {
        this.syncing = null;
      });
      await this.syncing;
    }
    return this.index;
  }

  private ask<T>(work: () => T | Promise<T>, what: string): Promise<T> {
    return withTimeout(
      Promise.resolve().then(work),
      LIST_DEADLINE_MS,
      (s) => `${this.id} did not answer ${what} within ${s} s`
    );
  }

  /**
   * What the source holds now. Incremental where the source can say which
   * items changed: their ids from `ids()`, the changed ones from
   * `changedSince`, the rest from the last listing. The whole list the first
   * time, and whenever the source cannot.
   */
  private async listing(): Promise<ConversationItem[]> {
    const source = this.source;
    if (this.listed && source.ids && source.changedSince) {
      const ids = new Set(
        (await this.ask(() => source.ids!(), "ids()"))
          .filter((id): id is string => typeof id === "string")
          .slice(0, MAX_CONVERSATIONS * 2)
      );
      const since = this.seenUntil;
      const changed = normalizeConversations(
        await this.ask(() => source.changedSince!(since), "changedSince()")
      );
      const next = new Map([...this.items].filter(([id]) => ids.has(id)));
      for (const item of changed) if (ids.has(item.id)) next.set(item.id, item);
      return normalizeConversations([...next.values()]);
    }
    return normalizeConversations(await this.ask(() => source.list(), "list()"));
  }

  private remember(items: readonly ConversationItem[]): void {
    this.items = new Map(items.map((item) => [item.id, item]));
    this.listed = true;
    this.seenUntil = items.reduce((latest, item) => Math.max(latest, item.updatedAt), 0);
  }

  /** List the source and bring `index` in line with it. */
  private async syncWith(index: ConversationIndex): Promise<void> {
    try {
      const items = await this.listing();
      this.remember(items);
      // No explicit load: the sync loads the model only if it has something
      // to embed.
      await index.sync(items);
      this.host.changed();
    } catch (e) {
      this.dirty = true;
      throw e;
    }
  }

  /**
   * The titles, listed from the source without touching the index: the
   * Recommended panel reads the stored index and never syncs it, and a card
   * without a title reads as its id.
   */
  private async loadTitles(): Promise<void> {
    if (this.listed && !this.dirty) return;
    this.remember(await this.listing());
  }

  /** Items like one of its own, from stored vectors. */
  vectorsOf(id: string): Int8Array[] | null {
    return this.index?.vectorsOf(id) ?? null;
  }

  /** Make sure the stored vectors are read, for `vectorsOf`. */
  async loadStored(): Promise<void> {
    await this.ready(false);
  }

  /** Items like a note's or another item's stored vectors. */
  async relatedToVectors(
    chunks: readonly Int8Array[],
    opts: { minScore: number; limit: number; exclude?: string }
  ): Promise<ScoredId[]> {
    const index = await this.ready(false);
    await this.loadTitles().catch((e: unknown) => {
      this.host.logger.warn(`semantic sources: ${this.id} could not be listed`, e);
    });
    const found = await index.relatedToVectors(chunks, {
      minScore: opts.minScore,
      limit: opts.limit + 1
    });
    this.catchUpInBackground();
    return found.filter((hit) => hit.id !== opts.exclude).slice(0, opts.limit);
  }

  /**
   * Bring the stored items up to date, without anyone waiting on it. The
   * Recommended panel answers from what is stored and never syncs, so without
   * this everything added since the last search was missing from every
   * note's recommendations.
   */
  private catchUpInBackground(): void {
    if (!this.dirty || this.catchingUp || !this.host.mayEmbedInBackground()) return;
    this.catchingUp = true;
    this.ready(true)
      .catch((e: unknown) => {
        this.host.logger.warn(`semantic sources: ${this.id} could not be brought up to date`, e);
      })
      .finally(() => {
        this.catchingUp = false;
      });
  }

  /** Items that answer `text`, best first. Brought up to date first only where
   *  the model may run in the background; the vault search's vector for the
   *  same text is ranked rather than embedding it a second time. */
  async search(
    text: string,
    opts: { minScore: number; limit: number; exclude: Iterable<string> }
  ): Promise<ScoredId[]> {
    const index = await this.ready(this.host.mayEmbedInBackground());
    const known = await this.host.queryVector(text);
    return known ? index.queryByVector(known, opts) : index.query(text, opts);
  }

  /** Show an item in the plugin that listed it, if it can. */
  open(id: string): boolean {
    if (!this.source.open) return false;
    try {
      this.source.open(id);
      return true;
    } catch (e) {
      this.host.logger.warn(`semantic sources: ${this.id} could not open an item`, e);
      return false;
    }
  }

  /** The link the source gives for an item, when it gives one a person may open. */
  link(id: string): string | null {
    if (!this.source.link) return null;
    try {
      return readLink(this.source.link(id));
    } catch (e) {
      this.host.logger.warn(`semantic sources: ${this.id} could not link an item`, e);
      return null;
    }
  }
}
