/**
 * The contract other plugins call: search by meaning, related items, and
 * sources of their own handed over to be indexed beside the vault.
 *
 * Open to any plugin. Obsidian plugins are not isolated from each other, so a
 * name a caller gives cannot be proved; what protects the vault is the
 * person, who allows each source before a word of it is indexed, and the
 * bounds here, which hold whatever a source lists. Everything a caller passes
 * is checked in this module.
 */

export const SEMANTIC_API_VERSION = 2;

/** At most this many hits per call, whatever is asked for. */
export const MAX_HITS = 50;

/** The most of a query that is embedded: the model reads a sentence or two,
 *  and a whole document pasted as the query cost a full inference for nothing. */
export const MAX_QUERY_CHARS = 1000;

/** How many sources may be registered at once. Each keeps an index of its own
 *  in memory, and a phone has little to spare. */
export const MAX_SOURCES = 8;

/** The vault's own kinds; every other kind is a source's. */
export type VaultKind = "note" | "image";
const VAULT_KINDS: readonly string[] = ["note", "image"];

/** A plugin id as Obsidian writes them, and so the only name a source may take. */
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A kind a source declares: a word, never one of the vault's. */
const SOURCE_KIND = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_LABEL_CHARS = 60;

export interface Hit {
  /** "note" or "image" for the vault; the kind its source declared otherwise. */
  kind: string;
  /** A vault path, or `<source>:<item>` for a source's item. */
  id: string;
  title: string;
  /** How well it answers, 0 to 1, read against the floor measured for its
   *  kind: comparable across kinds, which a raw similarity is not. */
  score: number;
  /** The raw cosine similarity, for a caller that keeps its own floors. */
  similarity: number;
  /** For a source's item: the source, and the item's own id. */
  source?: string;
  item?: string;
}

/** What a source tells about itself when it registers. */
export interface SourceDescriptor {
  /** What its items are, as one word: "conversation", "highlight". */
  kind: string;
  /** One item, as a row says it: "Conversation in Pythia". */
  label: string;
  /** Several, as a section header and the settings say it: "Pythia conversations". */
  plural: string;
  /** A name from Schreibstube's icon set, for its rows. */
  icon?: string;
}

export interface ItemSource extends SourceDescriptor {
  /** Every item, as `{ id, title, updatedAt, summary?, messages?, text?, notes? }`,
   *  `notes` being vault paths attached to it as context. Untrusted. */
  list(): unknown[] | Promise<unknown[]>;
  /** Called by the source when items changed. Returns the unsubscribe. */
  onChanged(cb: () => void): () => void;
  /** Show one item, when a row for it is pressed. Without it the row is not pressable. */
  open?(id: string): void;
  /** A link to one item, for "copy link": `obsidian://` or `https://` only. */
  link?(id: string): string;
  /**
   * What changed since the cursor this source handed back last time, so a sync
   * after the first reads only that: `{ changed, removed, cursor }`, `changed`
   * in `list()`'s shape and `removed` as ids. Called with null for the whole
   * list. The cursor is the source's own and never read here; anything the
   * source can compare — a revision, a hash of each item — works, and nothing
   * rests on two clocks agreeing.
   */
  changes?(cursor: string | null): unknown;
}

/** The longest cursor a source may hand back: one entry per item is room enough. */
export const MAX_CURSOR_CHARS = 256 * 1024;

/** Where a source stands with the person who runs this vault. */
export type SourceConsent = "pending" | "allowed" | "denied";

export interface SourceRegistration {
  /** Let the source go: its index stays on disk, unanswered until it returns. */
  release(): void;
  consent(): SourceConsent;
}

/**
 * How much a search can answer. "loading": the index is being read or built,
 * or will be on the first search. "unavailable": it cannot answer until the
 * person acts — the build failed, automatic builds are paused, or a phone
 * waits for the desktop's index — so a caller stops waiting.
 */
export type SearchStatus = "off" | "loading" | "unavailable" | "partial" | "ready";

export type RelatedRef = { path: string } | { source: string; id: string };

export interface QueryOptions {
  /** Kinds to answer with; all of them when absent. */
  kinds?: string[];
  /** Sources to answer from, besides the vault; all allowed ones when absent. */
  sources?: string[];
  limit?: number;
  /** Vault paths and `<source>:<item>` ids to leave out. */
  exclude?: string[];
}

/** A kind a search can answer with, and how one and several of it are called. */
export interface KindInfo {
  kind: string;
  label: string;
  plural: string;
  source: string | null;
}

export interface SchreibstubeSemanticApi {
  readonly version: 2;
  /** Whether search by meaning can answer here, and how much of it. */
  status(): SearchStatus;
  /** The kinds a search can answer with now: the vault's and every allowed source's. */
  kinds(): KindInfo[];
  search(text: string, opts?: QueryOptions): Promise<Hit[]>;
  related(ref: RelatedRef, opts?: Omit<QueryOptions, "exclude">): Promise<Hit[]>;
  registerSource(sourceId: string, source: ItemSource): SourceRegistration;
  /** Called when what a search can find has changed; at most once a second. */
  onIndexChanged(cb: () => void): () => void;
}

/** The text to search for: a string, trimmed and bounded; anything else is "". */
export function readQuery(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.trim().slice(0, MAX_QUERY_CHARS);
}

/** A requested limit as a whole number between 1 and `MAX_HITS`. */
export function clampLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 10;
  return Math.min(MAX_HITS, Math.max(1, Math.floor(limit)));
}

/** Strings from an optional list, each once, bounded; null when none was asked for. */
export function readNames(names: unknown, max = 64): Set<string> | null {
  if (!Array.isArray(names)) return null;
  return new Set(names.filter((n): n is string => typeof n === "string").slice(0, max));
}

/** Excluded ids as strings, bounded, so a huge list cannot slow every call. */
export function readExclude(exclude: unknown): Set<string> {
  return readNames(exclude, 1000) ?? new Set();
}

/** Whether a kind is asked for: every kind when none was named. */
export function wants(kinds: Set<string> | null, kind: string): boolean {
  return kinds === null || kinds.has(kind);
}

/** A source id as given, or null when it is not one a plugin could have. */
export function readSourceId(id: unknown): string | null {
  return typeof id === "string" && SOURCE_ID.test(id) ? id : null;
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text.slice(0, MAX_LABEL_CHARS) : null;
}

/**
 * What a registering source says about itself, checked: the two functions a
 * source needs, a kind that is not the vault's, labels a row can show. Null,
 * with the reason, when it cannot be taken.
 */
export function readSource(
  source: unknown,
  isIcon: (name: string) => boolean
): { source: ItemSource; descriptor: SourceDescriptor } | { problem: string } {
  if (typeof source !== "object" || source === null) return { problem: "not an object" };
  const s = source as Record<string, unknown>;
  if (typeof s.list !== "function" || typeof s.onChanged !== "function")
    return { problem: "a source needs list() and onChanged()" };
  const kind = typeof s.kind === "string" ? s.kind : "";
  if (!SOURCE_KIND.test(kind) || VAULT_KINDS.includes(kind))
    return { problem: `"${kind}" is not a kind a source may declare` };
  const one = label(s.label);
  const many = label(s.plural);
  if (!one || !many) return { problem: "a source needs a label and a plural" };
  const icon = typeof s.icon === "string" && isIcon(s.icon) ? s.icon : undefined;
  // Only the functions it declared, bound to it: what the source object holds
  // besides is never read again.
  const bound = <K extends keyof ItemSource>(key: K) =>
    typeof s[key] === "function"
      ? (s[key] as (...a: unknown[]) => unknown).bind(source)
      : undefined;
  const checked: ItemSource = {
    kind,
    label: one,
    plural: many,
    ...(icon ? { icon } : {}),
    list: bound("list") as ItemSource["list"],
    onChanged: bound("onChanged") as ItemSource["onChanged"],
    ...(bound("open") ? { open: bound("open") as NonNullable<ItemSource["open"]> } : {}),
    ...(bound("link") ? { link: bound("link") as NonNullable<ItemSource["link"]> } : {}),
    ...(bound("changes") ? { changes: bound("changes") as NonNullable<ItemSource["changes"]> } : {})
  };
  return {
    source: checked,
    descriptor: { kind, label: one, plural: many, ...(icon ? { icon } : {}) }
  };
}

/** A link a source handed over, if it is one Obsidian may open: its own
 *  scheme, or the web. */
export function readLink(link: unknown): string | null {
  if (typeof link !== "string" || link.length > 2000) return null;
  return /^(obsidian|https):\/\//i.test(link.trim()) ? link.trim() : null;
}

/** An item of a source as one id: never a vault path, which has no such prefix. */
const ITEM_PREFIX = "source:";

export function itemKey(source: string, item: string): string {
  return `${ITEM_PREFIX}${source}:${item}`;
}

/** The source and item a key names, or null for a vault path. */
export function splitItemKey(key: string): { source: string; item: string } | null {
  if (!key.startsWith(ITEM_PREFIX)) return null;
  const rest = key.slice(ITEM_PREFIX.length);
  const cut = rest.indexOf(":");
  return cut <= 0 ? null : { source: rest.slice(0, cut), item: rest.slice(cut + 1) };
}

/** The id a caller sees for an item — `<source>:<item>` — and back. */
export function publicItemId(source: string, item: string): string {
  return `${source}:${item}`;
}

export function readPublicItemId(id: string): { source: string; item: string } | null {
  const cut = id.indexOf(":");
  if (cut <= 0) return null;
  const source = readSourceId(id.slice(0, cut));
  return source ? { source, item: id.slice(cut + 1) } : null;
}

/**
 * How well a similarity answers, 0 to 1, against the floor measured for what
 * was compared: 0 at the floor, 1 at identity. Two kinds are measured at
 * different floors, so their raw similarities do not rank alike — a note at
 * 0.66 barely clears its floor where a conversation at 0.64 clears its own
 * with room — and a list merged by raw score put the wrong one first.
 */
export function relevance(similarity: number, floor: number): number {
  if (!Number.isFinite(similarity)) return 0;
  const room = 1 - floor;
  if (room <= 0) return similarity >= 1 ? 1 : 0;
  return Math.min(1, Math.max(0, (similarity - floor) / room));
}

/** Hits of several kinds as one list, most relevant first, capped. */
export function mergeHits(lists: readonly Hit[][], limit: number): Hit[] {
  return lists
    .flat()
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * The person's answer for each source, as `data.json` holds it: a map of
 * source id to allowed or not. Anything else in the file is dropped, and an
 * id that could not be a plugin's is not kept.
 */
export function normalizeSourceConsent(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  let kept = 0;
  for (const [id, allowed] of Object.entries(raw as Record<string, unknown>)) {
    if (kept >= 64) break;
    if (readSourceId(id) === null || typeof allowed !== "boolean") continue;
    out[id] = allowed;
    kept++;
  }
  return out;
}

/** Where a source stands, from what the person said. */
export function consentOf(answers: Readonly<Record<string, boolean>>, id: string): SourceConsent {
  if (!Object.prototype.hasOwnProperty.call(answers, id)) return "pending";
  return answers[id] ? "allowed" : "denied";
}
