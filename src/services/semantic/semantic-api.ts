/**
 * The contract other plugins call: search by meaning, related items, and
 * conversations handed over to be indexed.
 *
 * Supported for Pythia only. Obsidian plugins are not isolated from each
 * other, so "closed" cannot be enforced; what is enforced is who may register
 * a source, because a source is text that ends up in the index and costs
 * memory and embedding time. Everything a caller passes is checked here.
 */

export const SEMANTIC_API_VERSION = 1;

/** At most this many hits per call, whatever is asked for. */
export const MAX_HITS = 50;

/** The plugins allowed to register conversations. */
export const ALLOWED_SOURCES: readonly string[] = ["pythia"];

export type Kind = "note" | "image" | "conversation";
const KINDS: readonly Kind[] = ["note", "image", "conversation"];

export interface Hit {
  kind: Kind;
  /** A vault path for a note or a picture; the source's own id for a conversation. */
  id: string;
  title: string;
  score: number;
}

export interface ConversationSource {
  /** Every conversation, as `{ id, title, updatedAt, summary, messages }`. Untrusted. */
  list(): unknown[] | Promise<unknown[]>;
  /** Called by the source when conversations changed. Returns the unsubscribe. */
  onChanged(cb: () => void): () => void;
}

export type RelatedRef = { path: string } | { source: string; id: string };

export interface SchreibstubeSemanticApi {
  readonly version: 1;
  /** Whether search by meaning is switched on and may run on this device. */
  ready(): boolean;
  search(text: string, opts: { kinds: Kind[]; limit: number; exclude?: string[] }): Promise<Hit[]>;
  related(ref: RelatedRef, opts: { kinds: Kind[]; limit: number }): Promise<Hit[]>;
  registerSource(pluginId: string, source: ConversationSource): () => void;
  onIndexChanged(cb: () => void): () => void;
}

/** A requested limit as a whole number between 1 and `MAX_HITS`. */
export function clampLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 10;
  return Math.min(MAX_HITS, Math.max(1, Math.floor(limit)));
}

/** The requested kinds that exist, each once; nothing asked, nothing given. */
export function readKinds(kinds: unknown): Set<Kind> {
  if (!Array.isArray(kinds)) return new Set();
  return new Set(kinds.filter((k): k is Kind => KINDS.includes(k as Kind)));
}

/** Excluded ids as strings, bounded, so a huge list cannot slow every call. */
export function readExclude(exclude: unknown): Set<string> {
  if (!Array.isArray(exclude)) return new Set();
  return new Set(exclude.filter((e): e is string => typeof e === "string").slice(0, 1000));
}

/** Whether `source` has the two functions a conversation source needs. */
export function isConversationSource(source: unknown): source is ConversationSource {
  if (typeof source !== "object" || source === null) return false;
  const s = source as Record<string, unknown>;
  return typeof s.list === "function" && typeof s.onChanged === "function";
}

/** Hits of several kinds as one list, best first, capped. Scores are cosines
 *  from the same model, so they compare across kinds. */
export function mergeHits(lists: readonly Hit[][], limit: number): Hit[] {
  return lists
    .flat()
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
