/**
 * The two lists above the file tree: bookmarks, and the notes a source changed.
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
import { Notice, Platform, TFile, TFolder, type App } from "obsidian";
import { t } from "../i18n";
import { availableTarget, type PaneTarget } from "../services/pane-target";
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
import { hasWaitingUpdate, type SyncRecord } from "../services/sync-document";
import {
  hasUnseenSync,
  newestSync,
  parseExcludedPaths,
  selectLatest,
  type LatestCandidate,
  type LatestSelection
} from "../services/latest-files";

/**
 * Where the mark's "already seen" lives.
 *
 * Obsidian's local storage is per device and per vault, which is what this
 * wants: having looked at something is a fact about a person at a screen, not
 * about the vault. A change noticed on the laptop is still news on the phone,
 * and a mark that cleared itself on one device would be a mark nobody ever saw.
 */
const LATEST_SEEN_KEY = "schreibstube:latest:seen";

/**
 * What earlier versions kept on a device and nothing reads any more: the
 * bookmarks opened last, which "Open bookmark" once offered first. Cleared on
 * start so an update leaves nothing of it behind.
 */
export const RETIRED_STORAGE_KEYS: readonly string[] = ["schreibstube:bookmarks:recent"];

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

  private latest: LatestSelection | null = null;
  private latestKey = "";
  /** Null until this device has said what it has seen, which is not zero. */
  private seenAt: number | null = null;

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
    this.clearRetiredStorage();
    this.seenAt = this.readSeenAt();
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
    // Resolved from the file the link is written in, as Obsidian resolves it,
    // so a relative link beside a bookmarks file in a subfolder still finds it.
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, this.bookmarksPath());

    if (!file) {
      new Notice(t().common.notice(t().explorer.bookmarks.missingNote(linkpath)));
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(file);
  }

  // --- latest -------------------------------------------------------------

  /**
   * The notes whose source changed.
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

    this.latest = selectLatest(this.candidates(), {
      count: settings.explorerLatestCount,
      excluded: parseExcludedPaths(settings.explorerLatestExcluded)
    });
    this.latestKey = key;
    return this.latest;
  }

  /** Called for any vault change: the next draw recomputes rather than this one. */
  invalidateLatest(): void {
    this.latest = null;
    this.emit();
  }

  /**
   * Whether a source has changed since this device last acknowledged one.
   *
   * What the pane marks, and nothing more: the mark is read off the list a tap
   * on it opens, so it can never point at a note that list does not hold.
   */
  syncAlert(): boolean {
    const synced = this.latestFiles().synced;

    // Nothing is stored on a device that has never taken the mark down — which
    // is every device the first time this version runs. What a vault already
    // holds is not news, so the first look settles the score rather than
    // reporting every change a note ever had as unseen.
    if (this.seenAt === null) {
      this.seenAt = newestSync(synced) ?? 0;
      this.writeSeenAt();
      return false;
    }

    return hasUnseenSync(synced, this.seenAt);
  }

  /**
   * Take the mark down.
   *
   * Acknowledged up to the newest change rather than to this moment, so a poll
   * landing between the draw and the tap is not cleared unseen — it marks the
   * header again on the next draw.
   */
  acknowledgeSync(): void {
    const newest = newestSync(this.latestFiles().synced);
    if (newest === null || newest <= (this.seenAt ?? 0)) return;

    this.seenAt = newest;
    this.writeSeenAt();
    this.emit();
  }

  private clearRetiredStorage(): void {
    const storage = this.app as unknown as LocalStorageApi;
    if (
      typeof storage.loadLocalStorage !== "function" ||
      typeof storage.saveLocalStorage !== "function"
    ) {
      return;
    }

    for (const key of RETIRED_STORAGE_KEYS) {
      try {
        // Read first, so a device already clean is not written to on every start.
        if (storage.loadLocalStorage(key) !== null) storage.saveLocalStorage(key, null);
      } catch (error) {
        this.logger.debug(`Could not clear ${key}:`, error);
      }
    }
  }

  private readSeenAt(): number | null {
    const storage = this.app as unknown as LocalStorageApi;
    if (typeof storage.loadLocalStorage !== "function") return null;

    try {
      const raw = storage.loadLocalStorage(LATEST_SEEN_KEY);
      return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    } catch (error) {
      this.logger.debug("Could not read when the updates were last seen:", error);
      return null;
    }
  }

  private writeSeenAt(): void {
    const storage = this.app as unknown as LocalStorageApi;
    if (typeof storage.saveLocalStorage !== "function") return;

    try {
      storage.saveLocalStorage(LATEST_SEEN_KEY, this.seenAt ?? 0);
    } catch (error) {
      this.logger.debug("Could not store when the updates were last seen:", error);
    }
  }

  private candidates(): LatestCandidate[] {
    const syncState = this.getSettings().syncState;

    const candidates: LatestCandidate[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      // Listed under "updated externally" only while the update is still to be
      // taken: a note already level with its source has nothing for "Quelle
      // prüfen" to show, and a row and a mark promising otherwise were the
      // pane saying something the panel then denied.
      const record = syncState[file.path];
      const syncedAt = hasWaitingUpdate(record) ? record?.changedAt : undefined;
      if (syncedAt !== undefined)
        candidates.push({ path: file.path, name: file.basename, syncedAt });
    }

    return candidates;
  }

  async openLatest(path: string, where: PaneTarget = false): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.workspace.getLeaf(availableTarget(where, Platform.isDesktopApp)).openFile(file);
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
 * A short stand-in for the sync records, so the Latest list notices a poll.
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
  // An update accepted moves a record out of the list without changing when
  // its source last moved, so what is still waiting is counted as well.
  let waiting = 0;

  for (const record of Object.values(syncState)) {
    counted += 1;
    if (hasWaitingUpdate(record)) waiting += 1;
    if (record.changedAt !== undefined && record.changedAt > newest) newest = record.changedAt;
  }

  return `${counted}:${waiting}:${newest}`;
}
