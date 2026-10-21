/**
 * Reading notes: the notes that list what an Instapaper section gains.
 *
 * Every decision — what to ask, which bookmarks belong, what the block says
 * and how it changes — is in `instapaper-request`, `reading-history` and
 * `reading-summary`. This walks the vault's reading notes, sends the requests,
 * and writes the result into each note.
 */
import { MarkdownView, TFile, type App } from "obsidian";

import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { t } from "../i18n";
import { hasApiKey, resolveApiKey } from "../services/secret";
import { mapLimit } from "../utils/map-limit";
import { frontmatterLine } from "../services/sync-source";
import { parseSyncEvery, SYNC_EVERY_KEY } from "../services/sync-interval";
import { buildSummaryRequest, effectiveModel } from "../services/llm-providers";
import {
  isOldestFirst,
  MAX_SINCE_PAGES,
  newestPageOffset,
  parseReadingSource,
  READING_FROM_KEY,
  SINCE_PAGE_LIMIT,
  type Bookmark,
  type Highlight,
  type HighlightsOutcome,
  type ListOutcome,
  type ListRequestInput,
  type ReadingSection
} from "../services/instapaper-request";
import {
  applyEdit,
  buildReadingUpdate,
  isReadingDue,
  planHighlightWork,
  planReadingEdit,
  planSummaries,
  readReadingBlock,
  selectBookmarks,
  sinceFor,
  type ReadingCheckSummary,
  type ReadingUpdate
} from "../services/reading-history";
import {
  cleanReadingSummary,
  MAX_SUMMARIES_PER_CHECK,
  READING_SUMMARY_MAX_TOKENS,
  readingSummaryInput,
  readingSummaryPrompt
} from "../services/reading-summary";
import { fetchBookmarks, fetchHighlights } from "../platform/instapaper-client";
import { sendRequest } from "../platform/llm-client";

const HIGHLIGHT_CONCURRENCY = 4;
const SUMMARY_CONCURRENCY = 2;

export interface ReadingDeps {
  fetchBookmarks(input: ListRequestInput): Promise<ListOutcome>;
  fetchHighlights(bookmarkId: number, token: string): Promise<HighlightsOutcome>;
  /** The model's answer to one summary request; throws when it cannot be had. */
  summarize(system: string, content: string): Promise<string>;
  now(): Date;
}

class CheckFailed extends Error {}

export class ReadingHistoryController {
  private running = false;
  private readonly deps: ReadingDeps;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger,
    deps?: Partial<ReadingDeps>
  ) {
    this.deps = {
      fetchBookmarks,
      fetchHighlights,
      summarize: (system, content) => this.summarizeWithProvider(system, content),
      now: () => new Date(),
      ...deps
    };
  }

  /** Every note that names a reading list in its frontmatter. */
  readingNotes(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((file) => {
      const value: unknown =
        this.app.metadataCache.getFileCache(file)?.frontmatter?.[READING_FROM_KEY];
      return typeof value === "string" && value.trim().length > 0;
    });
  }

  /**
   * Check every reading note that is due, or every one when `force`.
   *
   * One note at a time: they all ask the same account, and a vault with three
   * reading notes is no reason to triple the requests at once.
   */
  async checkAll(force: boolean): Promise<ReadingCheckSummary> {
    const summary: ReadingCheckSummary = { checked: 0, added: 0, failed: 0 };
    const settings = this.getSettings();
    if (!settings.readingEnabled) return { ...summary, skipped: "disabled" };
    if (this.running) return { ...summary, skipped: "busy" };

    const files = this.readingNotes();
    if (files.length === 0) return summary;

    const token = resolveApiKey(
      this.app.secretStorage,
      settings.instapaperSecretName,
      t().settings.readingToken
    );
    if (!token.ok) return { ...summary, skipped: "noToken" };

    this.running = true;
    try {
      for (const file of files) {
        try {
          await this.checkNote(file, token.apiKey, force, summary);
        } catch (err) {
          summary.failed += 1;
          const reason = err instanceof Error ? err.message : String(err);
          summary.reason ??= reason;
          this.logger.warn(`${file.path}: ${reason}`);
        }
      }
    } finally {
      this.running = false;
    }

    this.logger.debug(
      `Reading history: ${summary.checked} checked, ${summary.added} added, ${summary.failed} failed.`
    );
    return summary;
  }

  private async checkNote(
    file: TFile,
    token: string,
    force: boolean,
    summary: ReadingCheckSummary
  ): Promise<void> {
    const text = await this.app.vault.read(file);
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

    const source = parseReadingSource(
      frontmatter?.[READING_FROM_KEY] ?? frontmatterLine(text, READING_FROM_KEY)
    );
    if (!source.ok) throw new CheckFailed(source.reason);

    const every = parseSyncEvery(
      frontmatter?.[SYNC_EVERY_KEY] ?? frontmatterLine(text, SYNC_EVERY_KEY)
    );
    if (every !== null && !every.ok) throw new CheckFailed(every.reason);

    const now = this.deps.now();
    const block = readReadingBlock(text);
    if (!force && !isReadingDue(block, every?.schedule ?? null, now)) return;

    const startedAt = Math.floor(now.getTime() / 1000);
    const listed = await this.listBookmarks(source.section, sinceFor(block), token);
    const selection = selectBookmarks({
      bookmarks: listed.bookmarks,
      section: source.section,
      block
    });

    // Without an AI key there is nobody to ask, and every summary owed would
    // fail on every check; the entries are written without them until one is chosen.
    const settings = this.getSettings();
    const summaries =
      settings.readingSummaries && hasApiKey(this.app.secretStorage, settings.llmSecretName);
    const work = planHighlightWork({
      selection,
      block,
      summaries,
      maxSummaries: MAX_SUMMARIES_PER_CHECK
    });
    const highlights = new Map<number, Highlight[]>();
    await mapLimit(work.fetch, HIGHLIGHT_CONCURRENCY, async (id) => {
      const outcome = await this.deps.fetchHighlights(id, token);
      if (!outcome.ok) throw new CheckFailed(outcome.message);
      highlights.set(id, outcome.highlights);
    });
    const highlightCounts = new Map([...highlights].map(([id, list]) => [id, list.length]));

    const titles = new Map(
      [...selection.added, ...selection.refreshed].map((bookmark) => [bookmark.id, bookmark.title])
    );
    const written = summaries
      ? await this.writeSummaries(
          planSummaries({
            selection,
            work,
            block,
            highlightCounts,
            max: MAX_SUMMARIES_PER_CHECK
          }),
          titles,
          highlights
        )
      : new Map<number, string>();

    // A since-window that did not fit in the pages read is asked again from
    // the same point next time, rather than skipped past and lost.
    const askedAt = listed.serverTime ?? startedAt;
    const checked = listed.complete || block === null ? askedAt : block.checked;
    const update = buildReadingUpdate({
      checked,
      now,
      selection,
      work,
      highlightCounts,
      summaries: written
    });
    await this.write(file, update);

    summary.checked += 1;
    summary.added += update.added.length;
  }

  /**
   * The bookmarks a check considers, newest first, and Instapaper's clock at
   * the first answer.
   *
   * A first check reads the newest page of the section. Which end of the
   * section that is, the documentation does not say, so the first page is
   * read for its order, and a section sorted oldest first is asked again for
   * its last page. A later check pages through what changed since the last.
   */
  private async listBookmarks(
    section: ReadingSection,
    since: number | null,
    token: string
  ): Promise<{ bookmarks: Bookmark[]; complete: boolean; serverTime: number | null }> {
    const fetchPage = async (offset: number) => {
      const outcome = await this.deps.fetchBookmarks({ section, since, offset, token });
      if (!outcome.ok) throw new CheckFailed(outcome.message);
      return outcome;
    };

    const first = await fetchPage(0);
    const serverTime = first.serverTime;

    if (since === null) {
      if (!isOldestFirst(first.bookmarks)) {
        return { bookmarks: first.bookmarks, complete: true, serverTime };
      }
      const offset = newestPageOffset(first.total);
      const newest = offset === 0 ? first : await fetchPage(offset);
      return { bookmarks: [...newest.bookmarks].reverse(), complete: true, serverTime };
    }

    const bookmarks = [...first.bookmarks];
    let total = first.total;
    for (let page = 1; page < MAX_SINCE_PAGES; page += 1) {
      const offset = page * SINCE_PAGE_LIMIT;
      if (offset >= total) return { bookmarks, complete: true, serverTime };
      const next = await fetchPage(offset);
      bookmarks.push(...next.bookmarks);
      total = next.total;
    }
    return { bookmarks, complete: MAX_SINCE_PAGES * SINCE_PAGE_LIMIT >= total, serverTime };
  }

  /**
   * Summaries for the articles that have highlights, as many as a check allows.
   *
   * A summary that fails is left out rather than failing the check: the entry
   * is worth having without it, and the next check writes the missing one.
   */
  private async writeSummaries(
    ids: number[],
    titles: Map<number, string>,
    highlights: Map<number, Highlight[]>
  ): Promise<Map<number, string>> {
    const written = new Map<number, string>();
    const system = readingSummaryPrompt();
    await mapLimit(ids, SUMMARY_CONCURRENCY, async (id) => {
      const input = readingSummaryInput(titles.get(id) ?? "", highlights.get(id) ?? []);
      if (input === null) return;
      try {
        const line = cleanReadingSummary(await this.deps.summarize(system, input));
        if (line !== null) written.set(id, line);
      } catch (err) {
        this.logger.warn(`Reading summary for bookmark ${id} failed:`, err);
      }
    });
    return written;
  }

  private async summarizeWithProvider(system: string, content: string): Promise<string> {
    const settings = this.getSettings();
    const key = resolveApiKey(this.app.secretStorage, settings.llmSecretName);
    if (!key.ok) throw new Error(key.message);
    const request = buildSummaryRequest(
      settings.llmProvider,
      effectiveModel(settings),
      key.apiKey,
      system,
      content,
      READING_SUMMARY_MAX_TOKENS
    );
    return sendRequest(settings.llmProvider, request);
  }

  /**
   * Write the update into the note.
   *
   * An open note is written through its editor: written to disk instead, the
   * editor merges the file back afterwards and can drop what it cannot place.
   * Either way the edit is planned against the text as it is now.
   */
  private async write(file: TFile, update: ReadingUpdate): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file?.path !== file.path) continue;

      const edit = planReadingEdit(view.editor.getValue(), update);
      view.editor.transaction({
        changes: [
          {
            from: view.editor.offsetToPos(edit.from),
            to: view.editor.offsetToPos(edit.to),
            text: edit.text
          }
        ]
      });
      return;
    }

    await this.app.vault.process(file, (current) =>
      applyEdit(current, planReadingEdit(current, update))
    );
  }
}
