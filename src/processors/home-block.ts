/**
 * The ```schreibstube-home``` block, drawn and kept current.
 *
 * What the block asks for and how each section is cut is decided in
 * `services/home-block`; the bookmarks and the notes a source changed come
 * from the pane's own sections controller, so the start page and the pane
 * never disagree about either. This file gathers, asks the service for the
 * page, hands it to the view, and draws again when what it read changes.
 */
import { MarkdownRenderChild, Notice, TFile, type App, type Plugin } from "obsidian";
import { activeLocale, t } from "../i18n";
import type { Bookmark, BookmarkEntry } from "../services/bookmark-file";
import { dueDateOf, type DueKeys } from "../services/due-date";
import {
  HOME_ACTION_COMMANDS,
  HOME_LANGUAGE,
  parseHomeBlock,
  planHome,
  readsDue,
  type DueCandidate,
  type HomeAction,
  type HomeBlock
} from "../services/home-block";
import type { LatestSelection } from "../services/latest-files";
import type { Logger } from "../services/logger";
import type { PaneTarget } from "../services/pane-target";
import { isoDate } from "../services/print-data";
import { hasCommand, runCommand } from "../services/workspace-internals";
import { openInPane } from "../platform/open-in-pane";
import { drawHome } from "../ui/home-block-view";

/**
 * How long the page waits for a burst of changes to end before drawing. A
 * sync brings dozens of notes at once, and the due section reads them all.
 */
const REDRAW_DELAY_MS = 300;

/** What the pane's sections controller lends the block. */
export interface HomeSources {
  bookmarkEntries(): BookmarkEntry[];
  bookmarksFileMissing(): boolean;
  bookmarksPath(): string;
  latestFiles(): LatestSelection;
  openBookmark(bookmark: Bookmark): void;
  pluginIconFor(bookmark: Bookmark): string | null;
  onChange(listener: () => void): () => void;
}

export interface HomeHost {
  sources(): HomeSources | null;
  dueKeys(): DueKeys;
  /** The plugin's own New note, as its command makes one. */
  newNote(): void;
  logger: Logger;
}

export function registerHomeBlock(plugin: Plugin, host: HomeHost): void {
  plugin.registerMarkdownCodeBlockProcessor(HOME_LANGUAGE, (source, el, ctx) => {
    ctx.addChild(new HomeBlockChild(plugin.app, el, parseHomeBlock(source), host));
  });
}

export class HomeBlockChild extends MarkdownRenderChild {
  private timer: number | null = null;

  constructor(
    private readonly app: App,
    containerEl: HTMLElement,
    private readonly block: HomeBlock,
    private readonly host: HomeHost
  ) {
    super(containerEl);
  }

  override onload(): void {
    this.draw();

    const sources = this.host.sources();
    if (sources) this.register(sources.onChange(() => this.drawSoon()));
    // Due days are frontmatter, which only the metadata cache announces; a
    // note renamed or deleted takes its row with it.
    if (readsDue(this.block)) {
      this.registerEvent(this.app.metadataCache.on("changed", () => this.drawSoon()));
    }
    this.registerEvent(this.app.vault.on("rename", () => this.drawSoon()));
    this.registerEvent(this.app.vault.on("delete", () => this.drawSoon()));
    this.register(() => {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = null;
    });
  }

  private drawSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.draw();
    }, REDRAW_DELAY_MS);
  }

  draw(): void {
    const sources = this.host.sources();
    const model = planHome(this.block, {
      bookmarks: sources?.bookmarkEntries().map((entry) => entry.bookmark) ?? [],
      bookmarksMissing: sources?.bookmarksFileMissing() ? sources.bookmarksPath() : null,
      updated:
        sources?.latestFiles().synced.map((file) => ({ path: file.path, name: file.name })) ?? [],
      due: readsDue(this.block) ? this.dueNotes() : [],
      today: isoDate(new Date()),
      locale: activeLocale(),
      available: (action) =>
        action === "new-note" || hasCommand(this.app, HOME_ACTION_COMMANDS[action])
    });

    drawHome(this.containerEl, model, {
      run: (action) => this.run(action),
      openBookmark: (bookmark) => sources?.openBookmark(bookmark),
      bookmarkPluginIcon: (bookmark) => sources?.pluginIconFor(bookmark) ?? null,
      open: (path, where) => void this.open(path, where)
    });
  }

  private dueNotes(): DueCandidate[] {
    const keys = this.host.dueKeys();
    const notes: DueCandidate[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const due = dueDateOf(this.app.metadataCache.getFileCache(file)?.frontmatter, keys);
      if (due) notes.push({ path: file.path, name: file.basename, due });
    }
    return notes;
  }

  private run(action: HomeAction): void {
    if (action === "new-note") {
      this.host.newNote();
      return;
    }
    if (!runCommand(this.app, HOME_ACTION_COMMANDS[action])) {
      new Notice(t().common.notice(t().startPage.actionFailed(t().startPage.actions[action])));
    }
  }

  private async open(path: string, where: PaneTarget): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    try {
      await openInPane(this.app, file, where);
    } catch (error) {
      this.host.logger.warn(`Could not open ${path} from the start page:`, error);
    }
  }
}
