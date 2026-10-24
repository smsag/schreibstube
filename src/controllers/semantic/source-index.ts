import type { Plugin } from "obsidian";
import type { Logger } from "../../services/logger";
import { ConversationIndex, type ScoredId } from "../../services/semantic/conversation-index";
import {
  MAX_CONVERSATIONS,
  normalizeChanges,
  normalizeConversations,
  type ConversationItem,
  type ItemChanges
} from "../../services/semantic/conversation-source";
import type { EmbeddingModelId } from "../../services/semantic/embedding-models";
import type { EmbeddingProvider } from "../../services/semantic/embedding-provider";
import { hashPolicyFor } from "../../services/semantic/row-provenance";
import { MAX_CURSOR_CHARS, readLink, type ItemSource } from "../../services/semantic/semantic-api";
import { withTimeout } from "../../utils/with-timeout";
import { SemanticIndexFiles } from "./index-files";

/** How long a source may take to answer. It is another plugin's code; an
 *  answer that never comes must not hold a search forever. */
const LIST_DEADLINE_MS = 5000;

/** Syncs an item's embed may fail in before it is left until it changes:
 *  one that fails every time would otherwise load the model for it at every
 *  sync, a Recommended answer's catching up included. */
export const MAX_EMBED_TRIES = 3;

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
  /**
   * Run `work`, which loads the model, under the engine's crash breaker; null
   * without running it where the model is paused — a phone it ended twice.
   */
  modelWork<T>(work: () => Promise<T>): Promise<T | null>;
}

/** What is kept of an item between syncs: never its text, which only an
 *  embed reads, and which for a thousand items is tens of megabytes. */
interface ItemMeta {
  title: string;
  notes: readonly string[];
  updatedAt: number;
}

/**
 * One source's items, indexed with the engine's model in a file of its own.
 *
 * The source is asked only when a question needs it and it said something
 * changed, so a plugin that saves after every keystroke costs nothing until
 * someone searches. A source that answers `changes(cursor)` is asked for what
 * moved since the cursor it handed back; one that does not hands over its
 * whole list. What a listing brings is applied to the index at the next sync
 * this device may run; a phone lists for titles and never embeds a source.
 */
export class SourceIndex {
  private index: ConversationIndex | null = null;
  private indexModel: EmbeddingModelId | null = null;
  private readonly unsubscribe: () => void;
  private meta = new Map<string, ItemMeta>();
  /** Items listed but not yet embedded, by id; held only where this device embeds. */
  private pending = new Map<string, ConversationItem>();
  /** The source's own cursor from its last answer; null asks for everything. */
  private cursor: string | null = null;
  private listed = false;
  /** The source said something changed since the last listing. */
  private stale = true;
  /** The index lags what was listed. */
  private dirty = true;
  private released = false;
  /** Moves whenever what was listed is forgotten — the source refused, the
   *  index reset, the source let go — so a listing still on its way then is
   *  dropped rather than applied to a listing that no longer exists. */
  private generation = 0;
  /** Syncs each pending item's embed failed in, by id. */
  private failures = new Map<string, number>();
  /** A background sync started by the Recommended panel is running. */
  private catchingUp = false;
  private listingRun: Promise<void> | null = null;
  private syncing: Promise<void> | null = null;
  /** The last read of the stored index. Kept past `release()`, so the index
   *  that replaces this one reads its file only after this read let go. */
  private reads: Promise<void> | null = null;
  /** Searches run one after another: each one runs the model on a phone, and
   *  a plugin asking after every pause in typing would otherwise run several
   *  at once. A search for exactly the one still running or waiting shares it. */
  private searchQueue: Promise<unknown> = Promise.resolve();
  private searchAsked: { key: string; answer: Promise<ScoredId[]> } | null = null;

  constructor(
    private readonly host: SourceIndexHost,
    readonly id: string,
    private readonly source: ItemSource,
    /** Whether this device embeds a source at all: a phone reads the desktop's file. */
    private readonly embedsHere: boolean,
    /** Whether the person allows the source now: asked again before any write. */
    private readonly allowed: () => boolean,
    /** The work of the index this one replaces: its file is read only after. */
    private readonly after: Promise<void> = Promise.resolve()
  ) {
    let unsubscribe: unknown;
    try {
      unsubscribe = source.onChanged(() => {
        this.stale = true;
      });
    } catch (e) {
      host.logger.warn(`semantic sources: ${id} could not be subscribed to`, e);
    }
    this.unsubscribe = typeof unsubscribe === "function" ? (unsubscribe as () => void) : () => {};
  }

  /** Stop: no listing, no embed and no write happens for this index after this. */
  release(): void {
    this.released = true;
    this.generation++;
    try {
      this.unsubscribe();
    } catch (e) {
      this.host.logger.warn(`semantic sources: ${this.id} could not be unsubscribed from`, e);
    }
    this.meta.clear();
    this.pending.clear();
    this.index = null;
  }

  /** A listing or a sync is running: the model must not be released under it. */
  isSyncing(): boolean {
    return this.listingRun !== null || this.syncing !== null || this.catchingUp;
  }

  /** The work under way, for a caller that must not overlap it. */
  settled(): Promise<void> {
    return Promise.all([this.listingRun, this.syncing, this.reads])
      .then(() => undefined)
      .catch(() => undefined);
  }

  size(): number {
    return this.meta.size;
  }

  /** Whether the source has been read this session. */
  isListed(): boolean {
    return this.listed;
  }

  titleOf(id: string): string | null {
    return this.meta.get(id)?.title.trim() || null;
  }

  titles(): { id: string; title: string }[] {
    return [...this.meta].map(([id, item]) => ({ id, title: item.title }));
  }

  /** The items that had `path` attached as context, from the last listing. */
  attachedTo(path: string): string[] {
    const ids: string[] = [];
    for (const [id, item] of this.meta) if (item.notes.includes(path)) ids.push(id);
    return ids;
  }

  /** Forget the index: the model changed, or search by meaning was switched off.
   *  The next sync lists everything again, since the new index has no rows. */
  reset(): void {
    this.index = null;
    this.indexModel = null;
    this.forgetListing();
  }

  /** Forget what was listed, texts and titles alike: the source was refused
   *  or is waiting, and nothing of it may stay in memory. */
  dropListing(): void {
    this.meta.clear();
    this.forgetListing();
  }

  private forgetListing(): void {
    this.generation++;
    this.cursor = null;
    this.listed = false;
    this.stale = true;
    this.dirty = true;
    this.pending.clear();
    this.failures.clear();
  }

  private files(modelId: EmbeddingModelId): SemanticIndexFiles {
    return new SemanticIndexFiles(this.host.plugin, modelId, ".bin", `semantic-source-${this.id}`);
  }

  private ask<T>(work: () => T | Promise<T>, what: string): Promise<T> {
    return withTimeout(
      Promise.resolve().then(work),
      LIST_DEADLINE_MS,
      (s) => `${this.id} did not answer ${what} within ${s} s`
    );
  }

  /** Read the source if it changed since the last listing; one listing at a time. */
  private async refresh(): Promise<void> {
    if (this.released || (this.listed && !this.stale)) return;
    if (this.listingRun) return this.listingRun;
    this.listingRun = this.readSource().finally(() => {
      this.listingRun = null;
    });
    return this.listingRun;
  }

  private async readSource(): Promise<void> {
    // Marked read before asking: a change the source reports while it answers
    // makes the next question ask again.
    this.stale = false;
    const generation = this.generation;
    // An answer that arrives after the person refused the source, or after the
    // index was reset or the source let go, is about a listing that no longer
    // exists: applied, it put a refused source's titles and texts back into
    // memory. It is dropped, and the next question asks again.
    const current = (): boolean => {
      if (!this.released && this.generation === generation && this.allowed()) return true;
      this.stale = true;
      return false;
    };
    try {
      if (this.source.changes) {
        const cursor = this.listed ? this.cursor : null;
        const delta = await this.askChanges(cursor);
        if (!current()) return;
        if (delta) {
          // What the answer is follows from what was asked: a null cursor
          // asks for everything, and what comes back replaces the listing.
          if (cursor === null) this.applyFull(delta.changed, delta.cursor);
          else this.applyDelta(delta);
          return;
        }
        this.host.logger.warn(
          `semantic sources: ${this.id} answered changes() with something else`
        );
        this.listed = false;
        this.cursor = null;
      }
      const items = normalizeConversations(await this.ask(() => this.source.list(), "list()"));
      if (!current()) return;
      this.applyFull(items, null);
    } catch (e) {
      this.stale = true;
      throw e;
    }
  }

  /** The source's changes since `cursor`, or null when the answer was not
   *  one: then the whole list is read, and the cursor starts over. */
  private async askChanges(cursor: string | null): Promise<ItemChanges | null> {
    const answer = await this.ask(() => this.source.changes!(cursor), "changes()");
    return normalizeChanges(answer, MAX_CURSOR_CHARS);
  }

  private applyFull(items: readonly ConversationItem[], cursor: string | null): void {
    this.meta = new Map(items.map((item) => [item.id, metaOf(item)]));
    this.pending = this.embedsHere ? new Map(items.map((item) => [item.id, item])) : new Map();
    this.failures.clear();
    this.cursor = cursor;
    this.listed = true;
    this.dirty = true;
  }

  private applyDelta(delta: ItemChanges): void {
    for (const id of delta.removed) {
      this.meta.delete(id);
      this.pending.delete(id);
    }
    for (const item of delta.changed) {
      this.meta.set(item.id, metaOf(item));
      if (this.embedsHere) this.pending.set(item.id, item);
      // Changed, it is a new text: the tries it used up were the old one's.
      this.failures.delete(item.id);
    }
    // The same cap as a whole list: the newest, however they arrived.
    if (this.meta.size > MAX_CONVERSATIONS) {
      const kept = [...this.meta]
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, MAX_CONVERSATIONS);
      this.meta = new Map(kept);
      for (const id of this.pending.keys()) if (!this.meta.has(id)) this.pending.delete(id);
    }
    this.cursor = delta.cursor;
    if (delta.changed.length > 0 || delta.removed.length > 0) this.dirty = true;
  }

  /**
   * The index, brought up to date with the source first when `embed` allows.
   *
   * Without it — the Recommended panel, which promises not to load the model,
   * and every phone — the stored index answers as it is. Loading the model to
   * embed one changed item on every note switch cost a phone several hundred
   * megabytes it had just released.
   */
  private async ready(embed: boolean): Promise<ConversationIndex | null> {
    // A plugin that registered again replaces an index that may be mid-embed;
    // it writes when it ends, and this one must read that, not write beside it.
    await this.after;
    if (this.released) return null;
    const modelId = this.host.modelId();
    if (!this.index || this.indexModel !== modelId) {
      this.index = new ConversationIndex(
        this.host.provider(),
        this.files(modelId),
        hashPolicyFor(modelId),
        (message, error) => this.host.logger.warn(`semantic sources: ${this.id}: ${message}`, error)
      );
      this.indexModel = modelId;
      // Another model's file holds other rows: everything is listed afresh.
      this.forgetListing();
    }
    const index = this.index;
    if (!embed || !this.embedsHere) {
      const read = index.loadStored();
      this.reads = read.catch(() => undefined);
      await read;
      return index;
    }
    if (this.syncing) {
      await this.syncing;
      return this.index;
    }
    this.syncing = this.sync(index).finally(() => {
      this.syncing = null;
    });
    await this.syncing;
    return this.index;
  }

  private async sync(index: ConversationIndex): Promise<void> {
    await this.refresh();
    if (!this.dirty) return;
    // The person may have said no while the source answered; a refused source
    // is not embedded, and nothing of it is written.
    if (this.released || !this.allowed() || this.index !== index) return;
    const changed = [...this.pending.values()];
    const keep = [...this.meta].sort((a, b) => b[1].updatedAt - a[1].updatedAt).map(([id]) => id);
    const failed = await index.update(changed, keep);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- another call may set it while this one awaited
    if (this.released || this.index !== index) return;
    for (const item of changed) {
      if (this.pending.get(item.id) !== item) continue;
      // An item whose embed failed stays pending: a source with a cursor will
      // not list it again until it changes, and dropped here it was never
      // found by meaning for the rest of the session.
      const tries = failed.has(item.id) ? (this.failures.get(item.id) ?? 0) + 1 : 0;
      if (tries > 0 && tries < MAX_EMBED_TRIES) {
        this.failures.set(item.id, tries);
        continue;
      }
      if (tries > 0) {
        this.host.logger.warn(
          `semantic sources: ${this.id}: an item could not be embedded in ${tries} tries; it is tried again when it changes`
        );
      }
      this.pending.delete(item.id);
      this.failures.delete(item.id);
    }
    this.dirty = this.pending.size > 0;
    this.host.changed();
  }

  /** Titles and attached notes, listed from the source without touching the index. */
  private async loadTitles(): Promise<void> {
    await this.refresh().catch((e: unknown) => {
      this.host.logger.warn(`semantic sources: ${this.id} could not be listed`, e);
    });
  }

  vectorsOf(id: string): Int8Array[] | null {
    return this.index?.vectorsOf(id) ?? null;
  }

  async loadStored(): Promise<void> {
    await this.ready(false);
  }

  /** Items like a note's or another item's stored vectors. */
  async relatedToVectors(
    chunks: readonly Int8Array[],
    opts: { minScore: number; limit: number; exclude?: string }
  ): Promise<ScoredId[]> {
    const index = await this.ready(false);
    if (!index) return [];
    await this.loadTitles();
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
    if (this.released || !this.dirty || this.catchingUp || !this.embedsHere) return;
    if (!this.host.mayEmbedInBackground()) return;
    this.catchingUp = true;
    this.ready(true)
      .catch((e: unknown) => {
        this.host.logger.warn(`semantic sources: ${this.id} could not be brought up to date`, e);
      })
      .finally(() => {
        this.catchingUp = false;
      });
  }

  /**
   * Items that answer `text`, best first. Brought up to date first only where
   * the model may run in the background; elsewhere the stored index answers,
   * and the titles are still read, since a hit without one cannot be shown.
   */
  search(
    text: string,
    opts: { minScore: number; limit: number; exclude: Iterable<string> }
  ): Promise<ScoredId[]> {
    const exclude = [...opts.exclude];
    const key = JSON.stringify([text, opts.minScore, opts.limit, exclude]);
    if (this.searchAsked?.key === key) return this.searchAsked.answer;
    const answer = this.searchQueue.then(() =>
      this.searchNow(text, { minScore: opts.minScore, limit: opts.limit, exclude })
    );
    this.searchQueue = answer.catch(() => undefined);
    const asked = { key, answer };
    this.searchAsked = asked;
    void answer
      .finally(() => {
        if (this.searchAsked === asked) this.searchAsked = null;
      })
      .catch(() => undefined);
    return answer;
  }

  private async searchNow(
    text: string,
    opts: { minScore: number; limit: number; exclude: Iterable<string> }
  ): Promise<ScoredId[]> {
    const embed = this.host.mayEmbedInBackground();
    const index = await this.ready(embed);
    if (!index) return [];
    if (!embed || !this.embedsHere) await this.loadTitles();
    const known = await this.host.queryVector(text);
    if (known) return index.queryByVector(known, opts);
    return (await this.host.modelWork(() => index.query(text, opts))) ?? [];
  }

  /** Whether the source shows an item itself when its row is pressed. */
  opensItself(): boolean {
    return !this.released && typeof this.source.open === "function";
  }

  open(id: string): boolean {
    if (this.released || !this.source.open) return false;
    try {
      this.source.open(id);
      return true;
    } catch (e) {
      this.host.logger.warn(`semantic sources: ${this.id} could not open an item`, e);
      return false;
    }
  }

  link(id: string): string | null {
    if (this.released || !this.source.link) return null;
    try {
      return readLink(this.source.link(id));
    } catch (e) {
      this.host.logger.warn(`semantic sources: ${this.id} could not link an item`, e);
      return null;
    }
  }
}

function metaOf(item: ConversationItem): ItemMeta {
  return { title: item.title, notes: item.notes, updatedAt: item.updatedAt };
}
