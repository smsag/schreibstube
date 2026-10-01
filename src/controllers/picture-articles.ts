import type { App } from "obsidian";
import { DESCRIPTION_KEYS } from "../services/image-description";
import type { Logger } from "../services/logger";
import {
  articleLinks,
  articlesOf,
  sameArticleLinks,
  type ArticleSources
} from "../services/picture-articles";
import { backlinkIndex } from "../services/related-notes";

/**
 * How long after the links settle a pass runs. Typing into an article
 * resolves its links again every couple of seconds; a pass per keystroke
 * would only find the same answer.
 */
export const ARTICLE_PASS_DELAY_MS = 2000;

/**
 * How many descriptions one pass writes before it yields. The first pass in
 * a vault writes every description once; a vault of thousands would hold the
 * app, and a phone, for the whole of it. The rest follow in the next pass.
 */
export const MAX_ARTICLE_WRITES_PER_PASS = 100;

export interface PictureArticleHooks {
  /** Every description note with the picture it is about, duplicates included. */
  describedPictures(): ReadonlyMap<string, string>;
  isDescriptionNote(path: string): boolean;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * Keeps each description note's `schreibstubeArticles` naming the notes its
 * picture appears in.
 *
 * A pass reads Obsidian's link table, inverts it once, and compares every
 * description's list with what the table says; only a description whose list
 * differs is written. Its own writes change no link the answer depends on, so
 * the pass after them finds nothing to do, and two devices reach the same
 * list and write the same bytes.
 *
 * Wiring only; which notes count is decided in `services/picture-articles`.
 */
export class PictureArticleLinker {
  private timer: unknown = null;
  private running = false;
  /** A pass was asked for while one ran, or one stopped at its bound. */
  private again = false;
  private stopped = false;

  constructor(
    private readonly app: App,
    private readonly hooks: PictureArticleHooks,
    private readonly logger: Logger
  ) {}

  /** The links may have moved: look again once they have settled. */
  schedule(): void {
    if (this.stopped) return;
    if (this.timer !== null) this.hooks.clearTimer(this.timer);
    this.timer = this.hooks.setTimer(() => {
      this.timer = null;
      void this.pass();
    }, ARTICLE_PASS_DELAY_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.hooks.clearTimer(this.timer);
    this.timer = null;
  }

  /** One pass over every description. Exposed for the tests; the plugin schedules it. */
  async pass(): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      await this.writeChanged();
    } catch (error) {
      this.logger.warn("Could not update the articles of a picture's description:", error);
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }

  private async writeChanged(): Promise<void> {
    const referrers = backlinkIndex(this.app.metadataCache.resolvedLinks);
    const sources: ArticleSources = {
      referrers: (path) => referrers.get(path) ?? [],
      isDescriptionNote: (path) => this.hooks.isDescriptionNote(path)
    };

    let written = 0;
    for (const [notePath, picture] of this.hooks.describedPictures()) {
      if (this.stopped) return;
      const note = this.app.vault.getFileByPath(notePath);
      if (!note) continue;
      const wanted = articleLinks(articlesOf(picture, sources));
      const current =
        this.app.metadataCache.getFileCache(note)?.frontmatter?.[DESCRIPTION_KEYS.articles];
      if (sameArticleLinks(current, wanted)) continue;
      if (written >= MAX_ARTICLE_WRITES_PER_PASS) {
        this.again = true;
        return;
      }
      await this.app.fileManager.processFrontMatter(
        note,
        (frontmatter: Record<string, unknown>) => {
          frontmatter[DESCRIPTION_KEYS.articles] = wanted;
        }
      );
      written += 1;
    }
  }
}
