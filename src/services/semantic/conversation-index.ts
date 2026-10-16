import type { EmbeddingProvider } from "./embedding-provider";
import { deserializeIndex, serializeIndex, type IndexedConversation } from "./embedding-index";
import type { IndexStore } from "./index-store";
import {
  cosine,
  maxPairwiseCosine,
  quantize,
  rankYieldEvery,
  MAX_SOURCE_CHUNKS
} from "./vector-math";
import { resolveRowHash, type HashPolicy } from "./row-provenance";
import { conversationChunks, type ConversationItem } from "./conversation-source";
import { isBackendGone } from "./embedding-provider";
import { isOutOfMemoryError } from "./memory-error";

/** Passages per request, as for notes (`EMBED_REQUEST_CHUNKS`): a long
 *  conversation sent whole ran out of its deadline and cost the whole sync. */
const CONVERSATION_REQUEST_CHUNKS = 16;

/** How long a read of the stored index may take. A file iCloud is still
 *  downloading can stall the read without end, and every search waits on it. */
export const READ_DEADLINE_MS = 20_000;

/** The pause before the one retry of a read that failed: long enough for a
 *  file a sync is writing to come free. */
export const READ_RETRY_MS = 250;

export interface ScoredId {
  id: string;
  score: number;
}

/**
 * Conversations by meaning: the index of what a source listed, kept in step
 * with it, and the two questions asked of it — which conversations are like
 * this one, and which answer this text.
 *
 * Pythia's `ConversationIndexService`, ported with its reasoning (Pythia
 * ADR-109, ADR-169, ADR-201): only new or changed conversations are embedded,
 * removed ones are dropped, and the result is written as one file. Provider and
 * store are interfaces, so all of it is tested with fakes.
 */
export class ConversationIndex {
  private items: IndexedConversation[] = [];
  private loaded = false;
  /** The read under way. Searches arrive faster than a phone reads the file,
   *  and each one used to read and decode the whole index again beside the
   *  others — several copies of it at once, on the device with least memory. */
  private loading: Promise<void> | null = null;
  private syncing: Promise<void> | null = null;

  /** The stored file's modification time as last read or written here. */
  private storedMtime: number | null = null;

  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly store: IndexStore,
    private readonly policy: HashPolicy,
    /** Where a read or decode that went wrong is said: never silently empty. */
    private readonly warn: (message: string, error?: unknown) => void = () => undefined,
    private readonly readDeadlineMs = READ_DEADLINE_MS
  ) {}

  isSyncing(): boolean {
    return this.syncing !== null;
  }

  size(): number {
    return this.items.length;
  }

  private load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    this.loading ??= this.read().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  /** The read under way, for a caller that must not start another beside it. */
  reading(): Promise<void> | null {
    return this.loading;
  }

  /**
   * One read, shared by everyone waiting on it. A read that fails is tried
   * once more after a pause, since one transient error would otherwise fail
   * every waiter together; a read that fails twice rejects them, and the next
   * caller reads again.
   */
  private async read(): Promise<void> {
    let buf: ArrayBuffer | null;
    try {
      buf = await this.readOnce();
    } catch (e) {
      this.warn("conversation index: could not read the stored index; trying once more", e);
      await new Promise((r) => setTimeout(r, READ_RETRY_MS));
      buf = await this.readOnce();
    }
    this.items = [];
    if (buf) {
      try {
        const { items, dim } = deserializeIndex(buf);
        // Another model's vectors: dropped, and the next sync rebuilds.
        if (dim === this.provider.dim) this.items = items;
      } catch (e) {
        // Said, not swallowed: on a phone an unreadable file means no search
        // finds a conversation; on a desktop, that the next sync embeds all.
        this.warn(
          "conversation index: the stored index could not be decoded; reading it as empty",
          e
        );
      }
    }
    await this.rememberMtime();
    this.loaded = true;
  }

  private readOnce(): Promise<ArrayBuffer | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`the stored index was not read within ${this.readDeadlineMs / 1000} s`)),
        this.readDeadlineMs
      );
    });
    return Promise.race([this.store.read(), deadline]).finally(() => clearTimeout(timer));
  }

  private async rememberMtime(): Promise<void> {
    try {
      this.storedMtime = (await this.store.mtime?.()) ?? null;
    } catch {
      // A store that cannot say when it changed reads as unchanged.
      this.storedMtime = null;
    }
  }

  /** Whether the file is no longer the one read or written here: another
   *  device's write, delivered by sync. */
  private async replacedOnDisk(): Promise<boolean> {
    if (!this.store.mtime || this.storedMtime === null) return false;
    try {
      const now = await this.store.mtime();
      return now !== null && now !== this.storedMtime;
    } catch {
      return false;
    }
  }

  /** Bring the index in line with `conversations`, the whole list. */
  async sync(conversations: readonly ConversationItem[]): Promise<void> {
    await this.update(
      conversations,
      conversations.map((c) => c.id)
    );
  }

  /**
   * Apply a change set: embed what `changed` holds anew, keep exactly the ids
   * in `keep`, in that order, and drop the rest. The whole list is the case
   * where every item is in `changed`; an incremental sync hands over only
   * what moved, so the full texts of everything else need not be held.
   * Concurrent calls run one after another.
   */
  async update(changed: readonly ConversationItem[], keep: readonly string[]): Promise<void> {
    while (this.syncing) await this.syncing.catch(() => undefined);
    this.syncing = this.doUpdate(changed, keep);
    try {
      await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  private async doUpdate(
    changed: readonly ConversationItem[],
    keep: readonly string[]
  ): Promise<void> {
    await this.load();
    const byId = new Map(this.items.map((i) => [i.id, i]));
    const wanted = new Set(keep);
    const embed: { id: string; contentHash: string; chunks: string[] }[] = [];
    for (const c of changed) {
      if (!wanted.has(c.id)) continue;
      const chunks = conversationChunks(c);
      const { hash, reuse } = resolveRowHash(this.policy, byId.get(c.id)?.contentHash, chunks);
      if (!reuse) embed.push({ id: c.id, contentHash: hash, chunks });
    }
    const dropped = [...byId.keys()].some((id) => !wanted.has(id));
    const reordered = !sameOrder(this.items, keep, byId);
    if (embed.length === 0 && !dropped && !reordered) return;

    let failures = 0;
    for (const d of embed) {
      try {
        const raw = await this.embedAll(d.chunks);
        byId.set(d.id, { id: d.id, contentHash: d.contentHash, chunks: raw.map(quantize) });
      } catch (e) {
        // A backend that is gone ends the sync; one item that fails keeps its
        // old row, if it had one, and is tried at the next sync.
        if (isBackendGone(e) || isOutOfMemoryError(e)) throw e;
        failures++;
      }
    }
    if (embed.length > 0 && failures === embed.length && !dropped) return; // nothing new
    this.items = keep
      .map((id) => byId.get(id))
      .filter((i): i is IndexedConversation => i !== undefined);
    await this.store.write(serializeIndex(this.items, this.provider.dim));
    // This device's own write is not another device's: no re-read for it.
    await this.rememberMtime();
  }

  private async embedAll(chunks: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += CONVERSATION_REQUEST_CHUNKS) {
      const batch = chunks.slice(i, i + CONVERSATION_REQUEST_CHUNKS);
      const vectors = await this.provider.embed(batch);
      if (vectors.length !== batch.length)
        throw new Error(`embed: ${batch.length} passages returned ${vectors.length} vectors`);
      out.push(...vectors);
    }
    return out;
  }

  /** The stored vectors of one item, or null when it has none: what "related
   *  to this item" is asked with, of every index. */
  vectorsOf(id: string): Int8Array[] | null {
    const item = this.items.find((i) => i.id === id);
    return item && item.chunks.length > 0 ? item.chunks : null;
  }

  /**
   * Read the stored index without embedding anything — and read it again when
   * another device replaced the file since. A phone does not build this index
   * but reads the desktop's, and one read at launch answered from that copy
   * all day: conversations from today were never found by meaning there.
   */
  async loadStored(): Promise<void> {
    if (this.loaded && !this.loading && !this.syncing && (await this.replacedOnDisk())) {
      // Checked again after the await: a read or a sync may have begun.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- another call may set them while this one awaited
      if (this.loaded && !this.loading && !this.syncing) this.loaded = false;
    }
    await this.load();
  }

  /** Conversations like `sourceId`, from stored vectors: no model call. */
  related(sourceId: string, opts: { minScore: number; limit: number }): ScoredId[] {
    return rankRelated(sourceId, this.items, opts);
  }

  /** Conversations like a note's stored vectors, best first. No model call;
   *  scanned cooperatively, since the note may bring many passages. */
  async relatedToVectors(
    chunks: readonly Int8Array[],
    opts: { minScore: number; limit: number }
  ): Promise<ScoredId[]> {
    if (chunks.length === 0) return [];
    const source = chunks.slice(0, MAX_SOURCE_CHUNKS);
    const yieldEvery = rankYieldEvery(source.length);
    const scored: ScoredId[] = [];
    let scanned = 0;
    for (const item of this.items) {
      if (item.chunks.length > 0) {
        const score = maxPairwiseCosine(source, item.chunks);
        if (Number.isFinite(score) && score >= opts.minScore) scored.push({ id: item.id, score });
      }
      if (++scanned % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, opts.limit);
  }

  /** Conversations that answer `text`, best first. Embeds the text once. */
  async query(
    text: string,
    opts: { minScore: number; limit: number; exclude?: Iterable<string> }
  ): Promise<ScoredId[]> {
    const q = text.trim();
    if (!q) return [];
    // A search that arrives during the read waits for it rather than finding nothing.
    await this.load();
    if (this.items.length === 0) return [];
    const [raw] = await this.provider.embed([q], { priority: true });
    if (!raw) return [];
    return rankByQuery(quantize(raw), this.items, opts);
  }

  /** Conversations that answer a query already embedded — the vault search's
   *  vector, so one search by meaning runs the model once for both indexes. */
  queryByVector(
    query: Int8Array,
    opts: { minScore: number; limit: number; exclude?: Iterable<string> }
  ): ScoredId[] {
    return rankByQuery(query, this.items, opts);
  }
}

/**
 * Conversations ranked by likeness to one of them: the best chunk-to-chunk
 * cosine between the two, the source left out, the floor applied, a screenful
 * kept — past that the list grows with the vault, not with relevance (Pythia
 * ADR-169).
 */
export function rankRelated(
  sourceId: string,
  index: readonly IndexedConversation[],
  opts: { minScore: number; limit: number }
): ScoredId[] {
  const source = index.find((i) => i.id === sourceId);
  if (!source || source.chunks.length === 0) return [];
  return index
    .filter((i) => i.id !== sourceId && i.chunks.length > 0)
    .map((i) => ({ id: i.id, score: maxPairwiseCosine(source.chunks, i.chunks) }))
    .filter((r) => Number.isFinite(r.score) && r.score >= opts.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit);
}

/** Conversations ranked by their best chunk against a query vector. */
export function rankByQuery(
  query: Int8Array,
  index: readonly IndexedConversation[],
  opts: { minScore: number; limit: number; exclude?: Iterable<string> }
): ScoredId[] {
  const excluded = new Set(opts.exclude ?? []);
  const scored: ScoredId[] = [];
  for (const item of index) {
    if (excluded.has(item.id) || item.chunks.length === 0) continue;
    let best = -Infinity;
    for (const chunk of item.chunks) best = Math.max(best, cosine(chunk, query));
    if (Number.isFinite(best) && best >= opts.minScore) scored.push({ id: item.id, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, opts.limit);
}

/** Whether the rows already stand in `keep`'s order, the ones it names. */
function sameOrder(
  rows: readonly IndexedConversation[],
  keep: readonly string[],
  byId: ReadonlyMap<string, IndexedConversation>
): boolean {
  const present = keep.filter((id) => byId.has(id));
  return present.length === rows.length && present.every((id, i) => rows[i]?.id === id);
}
