/**
 * The vault, as the filter sees it.
 *
 * This is the half of the search that the ranking's own tests never touched.
 * `file-search` decides what beats what, given fields; this is where a file's
 * fields come from in the first place — a title read out of frontmatter
 * somebody typed by hand, an alias that may be a list or a single string or a
 * number, tags written in two different places. A ranking that is right about
 * fields it never receives is a search that does nothing, and that failure is
 * invisible from the outside: the box still filters, just as badly as before.
 *
 * So the reading lives here, behind an interface the vault satisfies, and has
 * its own tests. Nothing in this file knows what Obsidian is; the view hands it
 * a source and asks for an order.
 *
 * The cache is the other reason this is a module and not a function. Tokenizing
 * is the expensive half of a keystroke and a file's name, title and tags do not
 * change between them — so a file is read once and kept until the vault says
 * that file changed, which turns a vault-sized cost per keystroke into a
 * vault-sized cost per edit.
 */
import {
  rankFiles,
  searchFields,
  type SearchCandidate,
  type SearchFields,
  type SearchHit
} from "./file-search";

/** A file the filter can offer, reduced to what naming it needs. */
export interface IndexedFile {
  path: string;
  /** The file name with its extension, as the vault stores it. */
  name: string;
}

/**
 * What the vault knows about one file beyond its name.
 *
 * Every field is `unknown` on purpose. This is frontmatter: another plugin
 * writes it, a person edits it by hand, and a sync delivers whatever was on the
 * other device. `aliases` being a list of strings is a convention, not a
 * guarantee.
 */
export interface FileMetadata {
  title?: unknown;
  aliases?: unknown;
  /** Tags as Obsidian reports them, `#` included; it reads frontmatter and
   *  body alike, which is what makes a tag search agree with its own. */
  tags?: readonly string[] | null;
  /** A picture's description, from the note that describes it. */
  description?: unknown;
}

/** Where the index reads from. The view satisfies this with the vault. */
export interface SearchSource {
  files(): readonly IndexedFile[];
  metadata(file: IndexedFile): FileMetadata | null;
}

/** What one draw of the filter needs to know. */
export interface SearchResult {
  /** Every file that matched, best first. */
  hits: SearchHit[];
  /** The best of them, as many as may be drawn. */
  shown: SearchHit[];
  /** How many matched but are not in `shown`. */
  held: number;
}

/**
 * A title as it can be used.
 *
 * Deliberately not `frontmatterTitle`: that one is the rule for what a *row*
 * is allowed to be drawn by, and a search wants to find a note by a title it
 * would not display. The only thing that matters here is that something
 * unusable never reaches the tokenizer as `"[object Object]"`.
 */
function usableText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

/**
 * Aliases, however they were written.
 *
 * Obsidian accepts a list, and a person editing frontmatter by hand writes a
 * bare string as often as not. A list holding a number, a null or a nested list
 * is neither of those and is dropped entry by entry rather than throwing the
 * whole note's aliases away.
 */
function aliasList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(usableText).filter((alias) => alias.length > 0);
  }
  const single = usableText(raw);
  return single.length > 0 ? [single] : [];
}

export class FileSearchIndex {
  /** One entry per file, dropped when the vault says that file changed. */
  private readonly cache = new Map<string, SearchFields>();

  constructor(private readonly source: SearchSource) {}

  /** Read one file's fields, from the cache when they are still good. */
  fieldsFor(file: IndexedFile): SearchFields {
    const cached = this.cache.get(file.path);
    if (cached) return cached;

    const metadata = this.source.metadata(file);
    const fields = searchFields({
      path: file.path,
      name: file.name,
      title: usableText(metadata?.title),
      aliases: aliasList(metadata?.aliases),
      tags: (metadata?.tags ?? []).map((tag) => tag.replace(/^#/, "")),
      description: usableText(metadata?.description)
    });
    this.cache.set(file.path, fields);
    return fields;
  }

  /** Throw away what was read about one file. */
  forget(path: string): void {
    this.cache.delete(path);
  }

  /**
   * Throw away what was read about everything under a folder.
   *
   * A folder deleted or renamed arrives as one event, for the folder; the
   * files inside it get none of their own. Forgetting only the folder's path
   * — which was never in the cache, folders are not searched — left every
   * file under it remembered under a path that no longer exists.
   */
  forgetUnder(folderPath: string): void {
    const prefix = `${folderPath}/`;
    for (const path of [...this.cache.keys()]) {
      if (path.startsWith(prefix)) this.cache.delete(path);
    }
  }

  /** Throw away everything, for a change too broad to name a file. */
  forgetAll(): void {
    this.cache.clear();
  }

  /** How many files have been read, so a test can prove the cache holds. */
  get size(): number {
    return this.cache.size;
  }

  /**
   * The files answering `query`, best first, and how many were held back.
   *
   * `limit` is a cap on what is drawn, never on what is searched: the count of
   * held-back results has to be the truth, or the line offering to narrow the
   * filter is guessing.
   */
  search(query: string, limit: number): SearchResult {
    const candidates: SearchCandidate[] = this.source
      .files()
      .map((file) => ({ path: file.path, fields: this.fieldsFor(file) }));

    const hits = rankFiles(query, candidates);
    const shown = hits.slice(0, limit);
    return { hits, shown, held: hits.length - shown.length };
  }
}
