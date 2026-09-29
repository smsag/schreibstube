import type { ScoredId } from "../../services/semantic/conversation-index";
import {
  matchConversationTitles,
  mergeConversationResults
} from "../../services/semantic/conversation-search";
import {
  MAX_SOURCES,
  itemKey,
  splitItemKey,
  type ItemSource,
  type SourceConsent,
  type SourceDescriptor,
  type SourceRegistration
} from "../../services/semantic/semantic-api";
import { SourceIndex, type SourceIndexHost } from "./source-index";

export interface SemanticSourcesHost extends SourceIndexHost {
  /** Whether search by meaning may run here now. */
  enabled(): boolean;
  /** What the person said about this source. */
  consent(id: string): SourceConsent;
  /** A source asked and the person has not answered yet. */
  askConsent(id: string, descriptor: SourceDescriptor): void;
}

/** A source's item found for a query or beside a note: its key and similarity. */
export interface ScoredKey {
  key: string;
  score: number;
}

/** A source's item for the Explorer's search: where it comes from, and its title. */
export interface SourceResult {
  key: string;
  title: string;
  source: string;
}

interface Entry {
  index: SourceIndex;
  descriptor: SourceDescriptor;
}

/**
 * Every source a plugin registered, each with its own index, answered as one.
 *
 * A source the person has not allowed is held and never read: nothing it
 * lists is embedded, and no question reaches it. Items are named by key —
 * `source:<id>:<item>` — so two sources may use the same ids, and no key is
 * ever taken for a vault path.
 */
export class SemanticSources {
  private readonly entries = new Map<string, Entry>();
  /** Moves when a source joins, leaves or is allowed, and after a sync. */
  private changes = 0;

  constructor(private readonly host: SemanticSourcesHost) {}

  register(id: string, source: ItemSource, descriptor: SourceDescriptor): SourceRegistration {
    if (!this.entries.has(id) && this.entries.size >= MAX_SOURCES) {
      throw new Error(`Schreibstube: at most ${MAX_SOURCES} sources may be registered`);
    }
    this.entries.get(id)?.index.release();
    const index = new SourceIndex({ ...this.host, changed: () => this.touched() }, id, source);
    const entry: Entry = { index, descriptor };
    this.entries.set(id, entry);
    if (this.host.consent(id) === "pending") this.host.askConsent(id, descriptor);
    this.touched();
    return {
      release: () => {
        if (this.entries.get(id) !== entry) return;
        entry.index.release();
        this.entries.delete(id);
        this.touched();
      },
      consent: () => this.host.consent(id)
    };
  }

  private touched(): void {
    this.changes++;
    this.host.changed();
  }

  /** The person answered for a source: what a search can find has changed. */
  consentChanged(): void {
    this.touched();
  }

  revision(): number {
    return this.changes;
  }

  /** Every registered source, allowed or not, for the settings. */
  registered(): {
    id: string;
    descriptor: SourceDescriptor;
    consent: SourceConsent;
    size: number;
  }[] {
    return [...this.entries].map(([id, entry]) => ({
      id,
      descriptor: entry.descriptor,
      consent: this.host.consent(id),
      size: entry.index.size()
    }));
  }

  /** The allowed sources a question may reach, optionally only the named ones. */
  private active(only: Set<string> | null = null): [string, Entry][] {
    if (!this.host.enabled()) return [];
    return [...this.entries].filter(
      ([id]) => this.host.consent(id) === "allowed" && (only === null || only.has(id))
    );
  }

  descriptorOf(id: string): SourceDescriptor | null {
    return this.entries.get(id)?.descriptor ?? null;
  }

  /** The allowed sources' kinds and labels. */
  kinds(): { source: string; descriptor: SourceDescriptor }[] {
    return this.active().map(([source, entry]) => ({ source, descriptor: entry.descriptor }));
  }

  private entryOf(key: string): { entry: Entry; item: string; source: string } | null {
    const parts = splitItemKey(key);
    if (!parts) return null;
    const entry = this.entries.get(parts.source);
    if (!entry || this.host.consent(parts.source) !== "allowed") return null;
    return { entry, item: parts.item, source: parts.source };
  }

  titleOf(key: string): string | null {
    const found = this.entryOf(key);
    return found ? found.entry.index.titleOf(found.item) : null;
  }

  open(key: string): boolean {
    const found = this.entryOf(key);
    return found ? found.entry.index.open(found.item) : false;
  }

  link(key: string): string | null {
    const found = this.entryOf(key);
    return found ? found.entry.index.link(found.item) : null;
  }

  /** The items that had `path` attached as context, as keys. */
  attachedTo(path: string): string[] {
    return this.active().flatMap(([source, entry]) =>
      entry.index.attachedTo(path).map((item) => itemKey(source, item))
    );
  }

  isSyncing(): boolean {
    return [...this.entries.values()].some((entry) => entry.index.isSyncing());
  }

  reset(): void {
    for (const entry of this.entries.values()) entry.index.reset();
  }

  /** Let every source go, at unload. */
  dispose(): void {
    for (const entry of this.entries.values()) entry.index.release();
    this.entries.clear();
  }

  private async each(
    only: Set<string> | null,
    ask: (index: SourceIndex, source: string) => Promise<ScoredId[]>
  ): Promise<ScoredKey[]> {
    const lists = await Promise.all(
      this.active(only).map(async ([source, entry]) => {
        try {
          return (await ask(entry.index, source)).map((hit) => ({
            key: itemKey(source, hit.id),
            score: hit.score
          }));
        } catch (e) {
          this.host.logger.warn(`semantic sources: ${source} could not be asked`, e);
          return [];
        }
      })
    );
    // One comparison, one model, one floor: similarities of two sources rank alike.
    return lists.flat().sort((a, b) => b.score - a.score);
  }

  /** Items that answer `text`, best first, across the allowed sources. */
  async search(
    text: string,
    opts: { minScore: number; limit: number; exclude: Set<string>; only?: Set<string> | null }
  ): Promise<ScoredKey[]> {
    const found = await this.each(opts.only ?? null, (index, source) =>
      index.search(text, {
        minScore: opts.minScore,
        limit: opts.limit,
        exclude: [...opts.exclude].flatMap((key) => {
          const parts = splitItemKey(key);
          return parts?.source === source ? [parts.item] : [];
        })
      })
    );
    return found.slice(0, opts.limit);
  }

  /** Items like stored vectors — a note's, or another item's — best first. */
  async relatedToVectors(
    chunks: readonly Int8Array[],
    opts: { minScore: number; limit: number; excludeKey?: string; only?: Set<string> | null }
  ): Promise<ScoredKey[]> {
    const skip = opts.excludeKey ? splitItemKey(opts.excludeKey) : null;
    const found = await this.each(opts.only ?? null, (index, source) =>
      index.relatedToVectors(chunks, {
        minScore: opts.minScore,
        limit: opts.limit,
        ...(skip?.source === source ? { exclude: skip.item } : {})
      })
    );
    return found.slice(0, opts.limit);
  }

  /** An item's stored vectors, read from its source's index. */
  async vectorsOf(key: string): Promise<Int8Array[] | null> {
    const found = this.entryOf(key);
    if (!found) return null;
    await found.entry.index.loadStored();
    return found.entry.index.vectorsOf(found.item);
  }

  /**
   * Items for what was typed into the Explorer's search: by the words of
   * their title, then by meaning. A meaning search that fails still leaves
   * the titles.
   */
  async find(
    text: string,
    limit: number,
    byMeaning: () => Promise<ScoredKey[]>
  ): Promise<SourceResult[]> {
    let meaning: ScoredKey[] = [];
    try {
      meaning = await byMeaning();
    } catch (e) {
      this.host.logger.warn("semantic sources: items could not be searched by meaning", e);
    }
    const known = this.active().flatMap(([source, entry]) =>
      entry.index.titles().map((item) => ({ id: itemKey(source, item.id), title: item.title }))
    );
    return mergeConversationResults(
      matchConversationTitles(text, known),
      meaning.flatMap((hit) => {
        const title = this.titleOf(hit.key);
        return title === null ? [] : [{ id: hit.key, title }];
      }),
      limit
    ).map((result) => ({
      key: result.id,
      title: result.title,
      source: splitItemKey(result.id)?.source ?? ""
    }));
  }
}
