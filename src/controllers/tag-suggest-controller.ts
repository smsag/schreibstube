/**
 * Suggest tags for a note, wired to the vault, Recommended and the model.
 *
 * The note's related notes come from Recommended, so the tags offered agree
 * with the notes shown beside it. Their tags, the vault's vocabulary and the
 * note's own are read from Obsidian's metadata cache, which costs no file
 * reads; the note itself is read once, for the keywords it states and, on
 * request, for the model. What is worth offering is decided in
 * `services/tag-suggestions`; this reads, asks and writes.
 */
import { getAllTags, Notice, TFile, type App } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import { withAddedTags } from "../services/frontmatter-tags";
import { statedKeywords } from "../services/stated-keywords";
import {
  suggestionsFrom,
  tagKey,
  tagVocabulary,
  voteTags,
  votingNotes,
  type RecommendedEntry,
  type TagNeighbour,
  type TagSuggestion,
  type TagVocabulary
} from "../services/tag-suggestions";
import { TagSuggestModal } from "../ui/tag-suggest-modal";

export interface TagSuggestions {
  vault: TagSuggestion[];
  stated: TagSuggestion[];
  /** Everything the note carries, by key. */
  carried: Set<string>;
  /** Every tag already offered, by key, so the model's are not offered twice. */
  offered: Set<string>;
  vocabulary: TagVocabulary;
  /** The note's text, for the model. */
  content: string;
}

export class TagSuggestController {
  /** One dialog at a time: a second press while it is open is the same question. */
  private dialogOpen = false;

  constructor(
    private readonly app: App,
    private readonly recommended: (path: string) => Promise<RecommendedEntry[]>,
    private readonly modelTags: (
      content: string,
      vocabulary: readonly string[]
    ) => Promise<string[] | null>,
    private readonly logger: Logger
  ) {}

  /**
   * Open the dialog for a note, from the control or the command.
   *
   * At once, with the suggestions following: asking Recommended may mean
   * reading the search index from disk first, and a press that shows nothing
   * for a second on a phone gets pressed again.
   */
  open(file: TFile | null): void {
    if (!file || file.extension !== "md") {
      new Notice(t().common.notice(t().properties.noNote));
      return;
    }
    if (this.dialogOpen) return;
    this.dialogOpen = true;

    const loading = this.suggestions(file).catch((error: unknown) => {
      this.logger.error(`Tag suggestions for ${file.path} failed:`, error);
      const reason = error instanceof Error ? error.message : String(error);
      new Notice(t().common.notice(t().tagSuggest.loadFailed(reason)));
      return null;
    });
    new TagSuggestModal(this.app, file.basename, {
      load: loading.then((found) => ({ vault: found?.vault ?? [], stated: found?.stated ?? [] })),
      askModel: async () => {
        const found = await loading;
        return found ? this.askModel(found) : null;
      },
      add: (tags) => void this.add(file, tags),
      closed: () => {
        this.dialogOpen = false;
      }
    }).open();
  }

  /** What the dialog offers before the model is asked. */
  async suggestions(file: TFile): Promise<TagSuggestions> {
    const vocabulary = this.vocabulary();
    const carried = new Set((this.tagsOf(file) ?? []).map(tagKey));

    let related: RecommendedEntry[] = [];
    try {
      related = await this.recommended(file.path);
    } catch (error) {
      // Search by meaning may be mid-build or failing; the tags of the notes
      // it would have added are a loss, the rest of the dialog is not.
      this.logger.warn(`Tag suggestions: no related notes for ${file.path}:`, error);
    }
    const neighbours: TagNeighbour[] = [];
    for (const entry of votingNotes(related)) {
      const note = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(note instanceof TFile)) continue;
      neighbours.push({ tags: this.tagsOf(note) ?? [], linked: entry.linked });
    }
    const vault = voteTags(neighbours, carried, vocabulary);
    const offered = new Set(vault.map((suggestion) => tagKey(suggestion.tag)));

    const content = await this.app.vault.cachedRead(file);
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const stated = suggestionsFrom(
      "stated",
      statedKeywords(frontmatter, content),
      carried,
      vocabulary,
      offered
    );

    return { vault, stated, carried, offered, vocabulary, content };
  }

  /** The model's tags, less what the dialog already shows. */
  async askModel(found: TagSuggestions): Promise<TagSuggestion[] | null> {
    const byUse = [...found.vocabulary.counts]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([key]) => found.vocabulary.spelling.get(key) ?? key);
    const proposals = await this.modelTags(found.content, byUse);
    if (proposals === null) return null;
    return suggestionsFrom("model", proposals, found.carried, found.vocabulary, found.offered);
  }

  /** Write the ticked tags into the note's `tags`, keeping what was there. */
  async add(file: TFile, tags: readonly string[]): Promise<void> {
    let added: string[] = [];
    try {
      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          const next = withAddedTags(frontmatter.tags, tags);
          added = next.added;
          if (added.length > 0) frontmatter.tags = next.tags;
        }
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Adding tags to ${file.path} failed:`, error);
      new Notice(t().common.notice(t().tagSuggest.writeFailed(reason)));
      return;
    }
    new Notice(t().common.notice(t().tagSuggest.added(added.length)));
  }

  /** Every note's tags, frontmatter and text alike, counted once per note. */
  private vocabulary(): TagVocabulary {
    const lists: string[][] = [];
    for (const file of this.app.vault.getMarkdownFiles()) lists.push(this.tagsOf(file) ?? []);
    return tagVocabulary(lists);
  }

  private tagsOf(file: TFile): string[] | null {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache ? getAllTags(cache) : null;
  }
}
