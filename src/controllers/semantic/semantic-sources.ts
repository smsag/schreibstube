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
import { removeSourceFiles } from "./index-files";
import { SourceIndex, type SourceIndexHost } from "./source-index";

export interface SemanticSourcesHost extends SourceIndexHost {
  /** Whether search by meaning may run here now. */
  enabled(): boolean;
  /** Whether this device embeds sources at all: a phone reads the desktop's files. */
  embedsHere(): boolean;
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
  private disposed = false;

  constructor(private readonly host: SemanticSourcesHost) {}

  register(id: string, source: ItemSource, descriptor: SourceDescriptor): SourceRegistration {
    if (this.disposed) throw new Error("Schreibstube: search by meaning has been unloaded");
    if (!this.entries.has(id) && this.entries.size >= MAX_SOURCES) {
      throw new Error(`Schreibstube: at most ${MAX_SOURCES} sources may be registered`);
    }
    // A plugin reloaded registers again: the old index stops before the new
    // one starts, so the two never write one file together.
    this.entries.get(id)?.index.release();
    const index = new SourceIndex(
      { ...this.host, changed: () => this.touched() },
      id,
      source,
      this.host.embedsHere(),
      () => this.host.consent(id) === "allowed"
    );
    const entry: Entry = { index, descriptor };
    this.entries.set(id, entry);
    this.askIfPending(id, descriptor);
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

  /** Ask about a source nobody answered for — only while search by meaning
   *  is on, since an Allow that changes nothing visible is a question wasted. */
  private askIfPending(id: string, descriptor: SourceDescriptor): void {
    if (this.host.enabled() && this.host.consent(id) === "pending") {
      this.host.askConsent(id, descriptor);
    }
  }

  /** Search by meaning was switched on: ask about every source still waiting. */
  askPending(): void {
    for (const [id, entry] of this.entries) this.askIfPending(id, entry.descriptor);
  }

  private touched(): void {
    this.changes++;
    this.host.changed();
  }

  /**
   * The person answered for a source. A refusal takes everything of it back:
   * what it listed leaves memory, and its index files leave the disk, since
   * a source the person said no to has no business keeping text here.
   */
  async consentChanged(id: string): Promise<void> {
    const consent = this.host.consent(id);
    if (consent !== "allowed") {
      this.entries.get(id)?.index.reset();
      this.entries.get(id)?.index.dropListing();
      if (consent === "denied") await this.removeFiles(id);
    }
    this.touched();
  }

  /** The files a source left, removed: for a refusal, or a source forgotten. */
  async removeFiles(id: string): Promise<void> {
    await this.entries.get(id)?.index.settled();
    await removeSourceFiles(this.host.plugin, id);
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
    listed: boolean;
  }[] {
    return [...this.entries].map(([id, entry]) => ({
      id,
      descriptor: entry.descriptor,
      consent: this.host.consent(id),
      size: entry.index.size(),
      listed: entry.index.isListed()
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

  /** Let every source go, at unload; a registration after this is refused. */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) entry.index.release();
    this.entries.clear();
  }

  private async perSource(
    only: Set<string> | null,
    ask: (index: SourceIndex, source: string) => Promise<ScoredId[]>
  ): Promise<{ source: string; entry: Entry; hits: ScoredKey[] }[]> {
    return Promise.all(
      this.active(only).map(async ([source, entry]) => {
        try {
          const hits = (await ask(entry.index, source)).map((hit) => ({
            key: itemKey(source, hit.id),
            score: hit.score
          }));
          return { source, entry, hits };
        } catch (e) {
          this.host.logger.warn(`semantic sources: ${source} could not be asked`, e);
          return { source, entry, hits: [] };
        }
      })
    );
  }

  /** One list across sources: one comparison, one model, one floor, so
   *  similarities of two sources rank alike. */
  private async each(
    only: Set<string> | null,
    ask: (index: SourceIndex, source: string) => Promise<ScoredId[]>
  ): Promise<ScoredKey[]> {
    return (await this.perSource(only, ask))
      .flatMap((answer) => answer.hits)
      .sort((a, b) => b.score - a.score);
  }

  private static excluding(exclude: Set<string>, source: string): string[] {
    return [...exclude].flatMap((key) => {
      const parts = splitItemKey(key);
      return parts?.source === source ? [parts.item] : [];
    });
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
        exclude: SemanticSources.excluding(opts.exclude, source)
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
   * Items for what was typed into the Explorer's search, up to `perSource`
   * from each source: by the words of their title, then by meaning. Capped
   * per source rather than in all, so one source whose titles happen to match
   * cannot push every other one off the list. A meaning search that fails
   * still leaves the titles.
   */
  async find(text: string, perSource: number, minScore: number): Promise<SourceResult[]> {
    const answers = await this.perSource(null, (index) =>
      index.search(text, { minScore, limit: perSource, exclude: [] })
    );
    return answers.flatMap(({ source, entry, hits }) => {
      const known = entry.index
        .titles()
        .map((item) => ({ id: itemKey(source, item.id), title: item.title }));
      const byMeaning = hits.flatMap((hit) => {
        const title = this.titleOf(hit.key);
        return title === null ? [] : [{ id: hit.key, title }];
      });
      return mergeConversationResults(
        matchConversationTitles(text, known),
        byMeaning,
        perSource
      ).map((result) => ({ key: result.id, title: result.title, source }));
    });
  }
}
