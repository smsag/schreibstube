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
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly store: IndexStore,
    private readonly policy: HashPolicy
  ) {}

  isSyncing(): boolean {
    return this.syncing !== null;
  }

  size(): number {
    return this.items.length;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const buf = await this.store.read();
    if (buf) {
      try {
        const { items, dim } = deserializeIndex(buf);
        // Another model's vectors: dropped, and the next sync rebuilds.
        if (dim === this.provider.dim) this.items = items;
      } catch {
        this.items = [];
      }
    }
    this.loaded = true;
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

  /** Read the stored index without embedding anything. */
  async loadStored(): Promise<void> {
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
    if (!q || this.items.length === 0) return [];
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
