/**
 * The two lists above the file tree: bookmarks, and what was written lately.
 *
 * They sit in one controller because they are the same kind of thing. Neither
 * writes anything, both are a snapshot of the vault re-derived when the vault
 * changes, and both are drawn by the pane that draws the tree. What they are
 * not is part of the tree: a bookmark has no path, and a note in "Latest" is
 * already somewhere else in the pane.
 *
 * Bookmarks come from a Markdown file a person edits by hand. That is the whole
 * contract: this reads the file, and nothing here ever writes it. A vault that
 * syncs then has one writer per device — the person — and a bookmark list that
 * can be fixed with a text editor when something is wrong with it.
 */
import { Notice, TFile, TFolder, type App } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import type { SchreibstubeSettings } from "../types";
import {
  bookmarkFolderPath,
  bookmarkLinkPath,
  emptyBookmarkTree,
  flattenBookmarks,
  parseBookmarkFile,
  type Bookmark,
  type BookmarkEntry,
  type BookmarkTree
} from "../services/bookmark-file";
import type { SyncRecord } from "../services/sync-document";
import {
  parseExcludedPaths,
  selectLatest,
  type LatestCandidate,
  type LatestSelection
} from "../services/latest-files";

/** How many opened bookmarks the quick-open list remembers. */
export const RECENT_BOOKMARKS_MAX = 5;

/**
 * Where the recents live.
 *
 * Obsidian's local storage is per device and per vault, which is what this
 * wants: a phone and a laptop each keep their own recents, and neither writes
 * to the bookmarks file to do it.
 */
const RECENTS_KEY = "schreibstube:bookmarks:recent";

/** The subset of Obsidian's App that keeps device-local state. Older builds
 *  may not have it, so every use is feature-detected. */
interface LocalStorageApi {
  loadLocalStorage?: (key: string) => unknown;
  saveLocalStorage?: (key: string, value: unknown) => void;
}

export class PaneSectionsController {
  private tree: BookmarkTree = emptyBookmarkTree();
  private loadedPath: string | null = null;
  private loading = false;
  private staleWhileLoading = false;
  private recents: string[] = [];

  private latest: LatestSelection | null = null;
  private latestKey = "";

  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger,
    /** Show a folder in the pane's own tree. The pane owns the tree, so a
     *  `vault://` bookmark reveals it here rather than in Obsidian's explorer. */
    private readonly reveal: (folderPath: string) => void
  ) {}

  async start(): Promise<void> {
    this.recents = this.readRecents();
    await this.reload();
  }

  stop(): void {
    this.listeners.clear();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- bookmarks ----------------------------------------------------------

  /** The bookmarks file path as configured, with surrounding slashes removed. */
  bookmarksPath(): string {
    return this.getSettings().explorerBookmarksFile.replace(/^\/+|\/+$/g, "");
  }

  bookmarks(): BookmarkTree {
    return this.tree;
  }

  bookmarkEntries(): BookmarkEntry[] {
    return flattenBookmarks(this.tree);
  }

  /** True while the configured file does not exist, which the pane says out
   *  loud rather than showing an empty list that looks broken. */
  bookmarksFileMissing(): boolean {
    const path = this.bookmarksPath();
    return path.length > 0 && !(this.app.vault.getAbstractFileByPath(path) instanceof TFile);
  }

  /** Re-read the file. Cheap enough to call on any change to that one path. */
  async reload(): Promise<void> {
    const path = this.bookmarksPath();
    this.loadedPath = path;

    if (path.length === 0) {
      this.replaceTree(emptyBookmarkTree());
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.replaceTree(emptyBookmarkTree());
      return;
    }

    // A write that lands while the previous read is in flight would otherwise be
    // lost, and the pane would show the file as it was one save ago.
    if (this.loading) {
      this.staleWhileLoading = true;
      return;
    }
    this.loading = true;

    try {
      this.replaceTree(parseBookmarkFile(await this.app.vault.cachedRead(file)));
    } catch (error) {
      this.logger.warn(`Could not read the bookmarks file at ${path}:`, error);
      this.replaceTree(emptyBookmarkTree());
    } finally {
      this.loading = false;
    }

    if (this.staleWhileLoading) {
      this.staleWhileLoading = false;
      await this.reload();
    }
  }

  /** Whether a vault change touched the bookmarks file, so only that one path
   *  costs a re-read. */
  isBookmarksFile(path: string): boolean {
    return path === this.bookmarksPath();
  }

  /** Called when the settings may have moved the file somewhere else. */
  async reloadIfPathChanged(): Promise<void> {
    if (this.loadedPath !== this.bookmarksPath()) await this.reload();
  }

  // --- opening ------------------------------------------------------------

  /**
   * Open what a bookmark points at.
   *
   * Every scheme was already checked while parsing, so this decides where a
   * known-good target opens rather than whether it may open at all.
   */
  openBookmark(bookmark: Bookmark): void {
    this.rememberRecent(bookmark.url);

    switch (bookmark.kind) {
      case "web":
        window.open(bookmark.url, "_blank", "noopener,noreferrer");
        return;
      case "obsidian":
        window.open(bookmark.url);
        return;
      case "folder":
        this.revealFolder(bookmark);
        return;
      case "note":
        void this.openNote(bookmark);
        return;
    }
  }

  private revealFolder(bookmark: Bookmark): void {
    const path = bookmarkFolderPath(bookmark.url);
    if (path === null) {
      new Notice(t().common.notice(t().explorer.bookmarks.badTarget(bookmark.name)));
      return;
    }

    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) {
      new Notice(t().common.notice(t().explorer.bookmarks.missingFolder(path)));
      return;
    }

    this.reveal(path);
  }

  private async openNote(bookmark: Bookmark): Promise<void> {
    const linkpath = bookmarkLinkPath(bookmark.url);
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, "");

    if (!file) {
      new Notice(t().common.notice(t().explorer.bookmarks.missingNote(linkpath)));
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(file);
  }

  /** The bookmarks opened most recently on this device, newest first. */
  recentBookmarks(): BookmarkEntry[] {
    const entries = this.bookmarkEntries();
    return this.recents
      .map((url) => entries.find((entry) => entry.bookmark.url === url))
      .filter((entry): entry is BookmarkEntry => entry !== undefined);
  }

  private rememberRecent(url: string): void {
    this.recents = [url, ...this.recents.filter((value) => value !== url)].slice(
      0,
      RECENT_BOOKMARKS_MAX
    );
    this.writeRecents();
  }

  private readRecents(): string[] {
    const storage = this.app as unknown as LocalStorageApi;
    if (typeof storage.loadLocalStorage !== "function") return [];

    try {
      const raw = storage.loadLocalStorage(RECENTS_KEY);
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((value): value is string => typeof value === "string")
        .slice(0, RECENT_BOOKMARKS_MAX);
    } catch (error) {
      this.logger.debug("Could not read the recent bookmarks:", error);
      return [];
    }
  }

  private writeRecents(): void {
    const storage = this.app as unknown as LocalStorageApi;
    if (typeof storage.saveLocalStorage !== "function") return;

    try {
      storage.saveLocalStorage(RECENTS_KEY, this.recents);
    } catch (error) {
      this.logger.debug("Could not store the recent bookmarks:", error);
    }
  }

  // --- latest -------------------------------------------------------------

  /**
   * The three recent-note lists.
   *
   * Computed on demand and kept until something changes it, because the pane
   * redraws on every vault event and a vault of a few thousand notes cannot be
   * sorted twice per keystroke.
   */
  latestFiles(): LatestSelection {
    const settings = this.getSettings();
    // The sync records are part of the answer now, so a poll that found a
    // source changed reaches the next draw rather than the cached answer.
    const key = [
      settings.explorerLatestCount,
      settings.explorerLatestExcluded,
      syncSignature(settings.syncState)
    ].join("|");

    if (this.latest && key === this.latestKey) return this.latest;

    const excluded = parseExcludedPaths(settings.explorerLatestExcluded);
    excluded.add(this.bookmarksPath());

    this.latest = selectLatest(this.candidates(), {
      count: settings.explorerLatestCount,
      excluded
    });
    this.latestKey = key;
    return this.latest;
  }

  /** Called for any vault change: the next draw recomputes rather than this one. */
  invalidateLatest(): void {
    this.latest = null;
    this.emit();
  }

  private candidates(): LatestCandidate[] {
    const syncState = this.getSettings().syncState;

    return this.app.vault.getMarkdownFiles().map((file) => ({
      path: file.path,
      name: file.basename,
      createdAt: file.stat.ctime,
      modifiedAt: file.stat.mtime,
      ...(syncState[file.path]?.changedAt !== undefined
        ? { syncedAt: syncState[file.path].changedAt }
        : {})
    }));
  }

  async openLatest(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  // --- internals ----------------------------------------------------------

  private replaceTree(tree: BookmarkTree): void {
    this.tree = tree;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * A short stand-in for the sync records, so the recent lists notice a poll.
 *
 * The lists are cached until something changes them, and a source changing is
 * now one of those things — but it happens in the plugin's data file rather
 * than in the vault, where no event reaches the pane. Counting the records and
 * taking the newest change is enough to tell two states apart without walking
 * anything twice.
 */
function syncSignature(syncState: Record<string, SyncRecord>): string {
  let newest = 0;
  let counted = 0;

  for (const record of Object.values(syncState)) {
    counted += 1;
    if (record.changedAt !== undefined && record.changedAt > newest) newest = record.changedAt;
  }

  return `${counted}:${newest}`;
}
