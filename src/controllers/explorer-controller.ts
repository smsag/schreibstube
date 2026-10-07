import { showActionNotice } from "../ui/action-notice";
import { copyText } from "../ui/copy-text";

import {
  getAllTags,
  Menu,
  Notice,
  Platform,
  TAbstractFile,
  TFile,
  TFolder,
  type App,
  type DataAdapter,
  type MenuItem
} from "obsidian";
import { hasApiKey } from "../services/secret";
import { fileNameParts } from "../services/file-glyph";
import { basename, checkFileName, type FileNameProblem } from "../services/file-name";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import type { SchreibstubeSettings } from "../types";
import { syncBadgeFor, type SyncBadge } from "../services/explorer-badge";
import { publishMarkFor, type PublishMark } from "../services/publish-mark";
import {
  buildExplorerMenu,
  buildSelectionMenu,
  buildTagPinMenu,
  type ExplorerAction,
  type ExplorerMenuItem,
  type ExplorerTarget,
  type ForeignItemMode,
  type SelectionAction,
  type SelectionMenuItem
} from "../services/explorer-menu";
import {
  UNDO_WINDOW_MS,
  UndoStack,
  type DeleteStep,
  type MoveStep,
  type UndoableAction
} from "../services/undo-stack";
import { topLevelOnly } from "../services/explorer-selection";
import type { PaneTarget } from "../services/pane-target";
import { openInPane } from "../platform/open-in-pane";
import { planImport, type DroppedFile, type ImportRefusal } from "../services/import-plan";
import {
  entryFor,
  markMissing,
  pinnedPaths,
  reattachOrphans,
  renamePath,
  setIcon,
  reorderKept,
  reorderPinned,
  setKept,
  setPinned,
  type ExplorerData
} from "../services/explorer-state";
import { ExplorerStore, type ExplorerFileStore } from "../services/explorer-store";
import { vaultUrlFor } from "../services/bookmark-file";
import { isAtOrUnder } from "../services/path-follow";

import { frontmatterTitle } from "../services/note-title";
import { getImageMimeType } from "../services/image-resize";
import {
  MAX_CSV_BYTES,
  MAX_CSV_COLUMNS,
  MAX_CSV_ROWS,
  csvToMarkdown,
  isCsvExtension,
  type CsvRefusal
} from "../services/csv-table";
import {
  isMovePlan,
  isUnder,
  moveDestinations,
  moveRefusalMessage,
  planMove,
  type MoveContext
} from "../services/tree-move";
import { hasSourceBinding, resolveSourceUrl, SYNC_FRONTMATTER_KEY } from "../services/sync-source";
import { someFileUnder } from "../services/vault-tree";
import { DescriptionFollower } from "./description-follower";
import { OrphanRepair, type OrphanRepairResult } from "./orphan-repair";
import { pairDescriptions, type DescriptionPairs } from "../services/description-pairs";
import { DESCRIPTION_KEYS } from "../services/image-description";
import {
  arrivedReceipt,
  isTrashedEntry,
  LOCAL_TRASH,
  localTrashPath,
  type TrashedShape
} from "../services/trash-receipt";
import { folderImages, hasFolderImages, type FolderImages } from "../services/folder-images";
import { openSubmenu } from "../services/workspace-internals";
import { describePollSummary, type PollSummary } from "../services/sync-summary";
import {
  sortTagCards,
  tagFromPinKey,
  tagPinKey,
  tallyTags,
  noteHasTag,
  vaultTags,
  type TagCard,
  type TaggedNote
} from "../services/tag-pins";
import { countsTasks, tallyTasks, type TaskTally } from "../services/task-count";
import { folderOf } from "../services/path-follow";
import {
  backlinkIndex,
  linkDegrees,
  rankRelated,
  relatedTags,
  type LinkDegrees,
  type RelatedSubject
} from "../services/related-notes";
import type { RelatedCard } from "../ui/related-notes-view";
import {
  ConfirmModal,
  FolderPickerModal,
  PromptModal,
  TagPickerModal
} from "../ui/explorer-modals";
import { IconPickerModal } from "../ui/icon-picker";

/** The file the pane's state lives in, inside the plugin's own folder. */
export const EXPLORER_STATE_FILE = "explorer.json";

/** How often the state file is checked for a write from another device. */
export const EXTERNAL_CHECK_MS = 15_000;

/**
 * How long a trashed row is taken on trust before the vault is believed again.
 *
 * The pane draws what the vault says it holds, and the vault says a file is
 * gone when its own watcher has noticed — which on a phone, behind a sync
 * client, is not the moment the file went. The row is taken away as soon as
 * the delete is confirmed, and this, counted from the moment that file's
 * trash call returns, is the outer limit on that: if no delete event ever
 * arrives, the row comes back rather than a file being hidden by a plugin
 * that was only ever guessing. Counted from the call's return, not the
 * confirm, because the calls run one after another: a batch of thirty, or
 * one call on a slow volume, would otherwise run the grace out while files
 * were still on their way to the trash, and their rows would come back.
 */
export const TRASH_GRACE_MS = 10_000;

/**
 * The source string handed to other plugins.
 *
 * Many plugins decide whether to contribute by looking at it, and almost all of
 * them look for `file-explorer`. Passing our own id would quietly empty the
 * "more actions" submenu, so the default matches what those plugins expect and
 * the setting exists for people who want the pane's menu to stay ours alone.
 */
export const FOREIGN_MENU_SOURCE = "file-explorer";

/**
 * What the explorer needs to name a file from what is inside it.
 *
 * A proposal and nothing else: the pane opens its own rename dialog with it, so
 * the naming and the renaming stay in the hands they were already in.
 */
export type FileNamer = (file: TFile) => Promise<string | null>;
/** Describes a picture and keeps the description as a note. */
export type ImageDescriber = (file: TFile) => Promise<void>;
/** Describes every undescribed picture under a folder. */
export type FolderDescriberHook = (folder: TFolder) => Promise<void>;

/** Where a pinned tag's notes are listed. The plugin owns the sidebar leaf. */
export type TagOpener = (tag: string) => Promise<void>;

/** Asks before something is destroyed. The default is the confirm dialog. */
export type Confirmer = (
  options: { title: string; message: string; submitLabel: string },
  onConfirm: () => void
) => void;

/**
 * What a test hands in so the controller runs without a window or a dialog.
 *
 * The same shape the store takes for the same reason: a timer that fires on
 * its own schedule and a dialog that waits for a click are the two things a
 * test cannot wait for, and both are decisions this controller makes.
 */
export interface ExplorerHooks {
  confirm?: Confirmer;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** A notice with a way to take the action back. */
  toast?: Toaster;
  /** Offers folders and reports the one chosen. The default is the picker. */
  pickFolder?: FolderPicker;
  now?: () => number;
}

export type FolderPicker = (
  folders: string[],
  title: string,
  onPick: (folder: string) => void
) => void;

/** Shows `message`, and `undoLabel` beside it; pressing that runs `onUndo`. */
export type Toaster = (message: string, undoLabel: string, onUndo: () => void) => void;

/** A file dropped from the desktop, with its bytes still to be read. */
export interface ImportSource extends DroppedFile {
  bytes: () => Promise<ArrayBuffer>;
}

/** How long the notice offering an undo stays. As long as the undo itself. */
const UNDO_NOTICE_MS = UNDO_WINDOW_MS;

/** Where a note's related notes are listed, for the same reason. */
export type RelatedOpener = (path: string) => Promise<void>;

/** Where a folder's pictures are laid out as tiles; `following` says whether
 *  the view then keeps up with the folder chosen in the pane. */
export type FolderTilesOpener = (folder: string, following: boolean) => Promise<void>;

/** A row in the pinned block: a file or a folder, or a tag. */
export type PinnedItem =
  { kind: "file"; key: string; file: TAbstractFile } | { kind: "tag"; key: string; tag: string };

/** What the explorer needs from the sync machinery, and nothing more. */
export interface ExplorerSyncBridge {
  checkFile(file: TFile): Promise<PollSummary>;
  checkFolder(path: string): Promise<PollSummary>;
  /** Drop the stored baseline, for a note that is no longer a mirror. */
  forget(path: string): Promise<void>;
}

export class ExplorerController {
  private readonly store: ExplorerStore;
  private readonly listeners = new Set<() => void>();
  /** The menu on screen, so a drag begun out of it can take it away again. */
  private openMenu: Menu | null = null;
  /** Paths trashed whose disappearance the vault has not reported yet. */
  private readonly trashed = new Set<string>();
  private submenusSupported: boolean | null = null;
  /** Set once the AI commands exist, which is after this controller is built. */
  private namer: FileNamer | null = null;
  private describer: ImageDescriber | null = null;
  private folderDescriber: FolderDescriberHook | null = null;
  /** Which note describes which picture; rebuilt after the vault changes. */
  private pairs: DescriptionPairs | null = null;
  private tagOpener: TagOpener | null = null;
  private relatedOpener: RelatedOpener | null = null;
  private tilesOpener: FolderTilesOpener | null = null;
  /** Who wants to know which folder was pressed in the pane. The pane does
   *  not: it says so, and whoever is listening decides what that means. */
  private readonly folderListeners = new Set<(folder: string) => void>();

  private readonly confirm: Confirmer;
  private readonly toast: Toaster;
  private readonly pickFolder: FolderPicker;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  /** The grace timer of each trashed path, so unloading can take them back. */
  private readonly trashTimers = new Map<string, unknown>();
  /** The last move or delete, for as long as it can be taken back. */
  private readonly undo = new UndoStack();
  /** Keeps each description note with its picture through a move or a delete. */
  private readonly follower: DescriptionFollower;
  /** Re-links description notes whose picture moved while nobody watched. */
  private readonly orphans: OrphanRepair;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly sync: ExplorerSyncBridge,
    private readonly logger: Logger,
    stateFile: ExplorerFileStore,
    hooks: ExplorerHooks = {}
  ) {
    this.setTimer = hooks.setTimer ?? ((callback, ms) => window.setTimeout(callback, ms));
    this.clearTimer = hooks.clearTimer ?? ((handle) => window.clearTimeout(handle as number));
    this.confirm =
      hooks.confirm ??
      ((options, onConfirm) => new ConfirmModal(this.app, options, onConfirm).open());
    this.toast =
      hooks.toast ??
      ((message, label, onUndo) => showActionNotice(message, label, onUndo, UNDO_NOTICE_MS));
    this.pickFolder =
      hooks.pickFolder ??
      ((folders, title, onPick) => new FolderPickerModal(this.app, folders, title, onPick).open());
    this.now = hooks.now ?? (() => Date.now());
    this.store = new ExplorerStore({
      file: stateFile,
      logger,
      setTimer: this.setTimer,
      clearTimer: this.clearTimer
    });
    this.store.onChange(() => this.emit());
    this.follower = new DescriptionFollower(
      app,
      {
        setTimer: this.setTimer,
        clearTimer: this.clearTimer,
        changed: () => {
          this.descriptionsChanged();
          this.emit();
        }
      },
      logger
    );
    this.orphans = new OrphanRepair(
      app,
      () => this.descriptionPairs(),
      () => {
        this.descriptionsChanged();
        this.emit();
      },
      logger
    );
  }

  /** Match orphaned description notes to their pictures by content. */
  repairOrphans(): Promise<OrphanRepairResult> {
    return this.orphans.repair();
  }

  /**
   * Forget which notes describe which pictures: a note changed, moved or went.
   * Rebuilt on the next question, from frontmatter the metadata cache already
   * holds, so a burst of changes costs one rebuild.
   */
  descriptionsChanged(): void {
    this.pairs = null;
  }

  private descriptionPairs(): DescriptionPairs {
    if (this.pairs) return this.pairs;
    const candidates = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter || !(DESCRIPTION_KEYS.image in frontmatter)) continue;
      candidates.push({
        path: file.path,
        imageLink: frontmatter[DESCRIPTION_KEYS.image],
        describedAt: frontmatter[DESCRIPTION_KEYS.describedAt]
      });
    }
    this.pairs = pairDescriptions(
      candidates,
      (link, from) => this.app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? null
    );
    return this.pairs;
  }

  /**
   * Whether a change to this path can change the pairing: it is a description
   * note or a described picture as things stand, or it now carries the key.
   * Every save of every note is a metadata change, and rebuilding the pairing
   * for each would scan the vault's frontmatter every couple of seconds while
   * someone types.
   */
  touchesDescriptions(path: string): boolean {
    const pairs = this.descriptionPairs();
    if (pairs.notes.has(path) || pairs.byImage.has(path) || pairs.orphans.includes(path))
      return true;
    // A folder is reported once for everything under it, so it touches the
    // pairing when any note or picture in it does; a file that is gone or was
    // just made has no cache entry to ask, only the paths already paired.
    const under = (paired: string): boolean => isAtOrUnder(paired, path);
    if ([...pairs.notes, ...pairs.byImage.keys(), ...pairs.orphans].some(under)) return true;
    const file = this.app.vault.getFileByPath(path);
    const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    return frontmatter !== undefined && DESCRIPTION_KEYS.image in frontmatter;
  }

  /**
   * Whether this note describes a picture that is there: the tree shows the
   * picture in its place, and the note is reached from the picture's mark.
   */
  foldsIntoPicture(path: string): boolean {
    return this.descriptionPairs().notes.has(path);
  }

  /**
   * Whether this note describes a picture, there or gone. Never a row in the
   * search or in Recommended: the picture carries the note's words and stands
   * for it, and a note whose picture is gone describes nothing anyone looked
   * for. Listing it put every described picture in the results twice, one row
   * of it named like a file nobody wrote. The tree still shows an orphaned
   * one — where else would anyone see that it has lost its picture.
   */
  isDescriptionNote(path: string): boolean {
    const pairs = this.descriptionPairs();
    return pairs.notes.has(path) || pairs.orphans.includes(path);
  }

  /**
   * Whether a folder holds only description notes that are hidden. At least
   * one, so an empty folder stays: it is somebody's, not ours.
   */
  hidesFolder(folder: TFolder): boolean {
    return (
      someFileUnder(folder, (file) => this.foldsIntoPicture(file.path)) &&
      !someFileUnder(folder, (file) => !this.foldsIntoPicture(file.path))
    );
  }

  /** The note a picture's description lives in, if it has one. */
  descriptionNoteOf(imagePath: string): string | null {
    return this.descriptionPairs().byImage.get(imagePath) ?? null;
  }

  /** The picture a note describes, if it is a description note. */
  imageDescribedBy(notePath: string): string | null {
    return this.descriptionPairs().byNote.get(notePath) ?? null;
  }

  /** Every description note with the picture it is about, duplicates included. */
  describedPictures(): ReadonlyMap<string, string> {
    return this.descriptionPairs().pictureOf;
  }

  /**
   * What a picture is found by, from its description note: the note's title,
   * its keywords and its description. Frontmatter as the metadata cache holds
   * it, untrusted in shape; the search index validates every field.
   */
  descriptionFields(
    imagePath: string
  ): { title: unknown; keywords: unknown; description: unknown } | null {
    const notePath = this.descriptionNoteOf(imagePath);
    const note = notePath ? this.app.vault.getFileByPath(notePath) : null;
    const frontmatter = note ? this.app.metadataCache.getFileCache(note)?.frontmatter : undefined;
    if (!frontmatter) return null;
    return {
      title: frontmatter.title,
      keywords: frontmatter[DESCRIPTION_KEYS.keywords],
      description: frontmatter[DESCRIPTION_KEYS.description]
    };
  }

  useDescriber(describer: ImageDescriber): void {
    this.describer = describer;
  }

  useFolderDescriber(describer: FolderDescriberHook): void {
    this.folderDescriber = describer;
  }

  useNamer(namer: FileNamer): void {
    this.namer = namer;
  }

  useTagOpener(opener: TagOpener): void {
    this.tagOpener = opener;
  }

  useRelatedOpener(opener: RelatedOpener): void {
    this.relatedOpener = opener;
  }

  useFolderTilesOpener(opener: FolderTilesOpener): void {
    this.tilesOpener = opener;
  }

  async start(): Promise<void> {
    await this.store.load();
    // A vault that was edited elsewhere while this one was closed: hand back
    // the icons of anything that only moved.
    this.store.mutate((data, now) => reattachOrphans(data, this.allPaths(), now));
  }

  async stop(): Promise<void> {
    await this.store.flush();
    this.store.dispose();
    // A delete confirmed seconds before unloading has a timer still to fire,
    // and it would fire into a controller nobody listens to.
    for (const handle of this.trashTimers.values()) this.clearTimer(handle);
    this.trashTimers.clear();
    this.follower.stop();
    this.trashed.clear();
    this.listeners.clear();
    this.folderListeners.clear();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called with the folder a person pressed in the pane, for as long as the
   *  unsubscribe returned here has not been called. */
  onFolderChosen(listener: (folder: string) => void): () => void {
    this.folderListeners.add(listener);
    return () => this.folderListeners.delete(listener);
  }

  /** The pane says a folder was pressed. What follows from that is not its business. */
  noteFolderChosen(path: string): void {
    for (const listener of this.folderListeners) listener(path);
  }

  data(): ExplorerData {
    return this.store.data();
  }

  async checkForExternalChange(): Promise<void> {
    await this.store.refreshFromDisk();
  }

  // --- vault events -------------------------------------------------------

  handleRename(file: TAbstractFile, oldPath: string): void {
    // Something renamed onto a path that was trashed a moment ago is there
    // now, whatever was trashed: the same rule as a create, which this is
    // from the pane's point of view.
    this.forgetTrashedAround(file.path);
    this.store.mutate((data, now) => renamePath(data, oldPath, file.path, now));
    // The pairing is by path, so a move changes it before the metadata cache
    // says a word: the pane used to keep folding a note into a picture that
    // was no longer where the pairing had it.
    if (this.pairs && (this.touchesDescriptions(oldPath) || this.touchesDescriptions(file.path))) {
      this.descriptionsChanged();
    }
    this.follower.pictureRenamed(file, oldPath);
  }

  handleDelete(file: TAbstractFile): void {
    // The vault has caught up with what the pane already drew.
    this.forgetTrashed(file.path);
    this.store.mutate((data, now) => markMissing(data, file.path, now));
    if (this.pairs && this.touchesDescriptions(file.path)) this.descriptionsChanged();
    this.follower.pictureDeleted(file);
    // Not every delete changes the state file — a note with no icon and no
    // mark changes nothing — and the pane still has a row to take away.
    this.emit();
  }

  /** A file appearing may be one that moved outside Obsidian, so it can claim
   *  the icon of a tombstone with the same name. */
  handleCreate(file: TAbstractFile): void {
    // A path written again is a path that exists, whatever was trashed there
    // — and so does every folder above it.
    this.forgetTrashedAround(file.path);
    this.store.mutate((data, now) => reattachOrphans(data, [file.path], now));
    // A picture arriving where an orphaned note's link points makes a pair;
    // which picture that would be, the pairing does not say, so any arrival
    // while a note is orphaned is asked again. Rebuilt lazily, and never
    // rebuilt only to be asked: a pairing already dropped stays dropped, so a
    // burst of arrivals costs one rebuild at the next draw.
    if (this.pairs && (this.touchesDescriptions(file.path) || this.pairs.orphans.length > 0)) {
      this.descriptionsChanged();
    }
  }

  /**
   * Whether the pane should act as though this path were already gone.
   *
   * True between the delete being confirmed and the vault reporting the
   * disappearance, which is not the same instant: the vault answers when its
   * own watcher has noticed, and on a phone that is after a sync client has.
   * A folder takes everything under it.
   */
  isTrashed(path: string): boolean {
    if (this.trashed.size === 0) return false;
    if (this.trashed.has(path)) return true;

    for (const gone of this.trashed) {
      if (isUnder(path, gone)) return true;
    }
    return false;
  }

  /**
   * Drop a path and everything under it from what is being held back.
   *
   * For a delete event: the vault has confirmed this much is gone. Nothing
   * above it is touched, because a folder trashed as a whole may see its
   * children reported gone one by one, and clearing the folder on the first
   * would draw it again, half-emptied, until the rest arrive.
   */
  private forgetTrashed(path: string): void {
    if (this.trashed.size === 0) return;

    const prefix = `${path}/`;
    for (const gone of [...this.trashed]) {
      if (gone === path || gone.startsWith(prefix)) this.dropTrashed(gone);
    }
  }

  /**
   * Drop a path, everything under it, and everything above it.
   *
   * For a create or a rename: a path that exists means every folder holding
   * it exists too. Without the upward walk, a folder trashed and refilled by
   * a sync client within the grace stayed hidden, children and all, until the
   * timer gave up — the one outcome the grace was built to rule out.
   */
  private forgetTrashedAround(path: string): void {
    if (this.trashed.size === 0) return;

    this.forgetTrashed(path);
    for (const gone of [...this.trashed]) {
      if (isUnder(path, gone)) this.dropTrashed(gone);
    }
  }

  private dropTrashed(path: string): void {
    this.trashed.delete(path);
    const handle = this.trashTimers.get(path);
    if (handle !== undefined) {
      this.clearTimer(handle);
      this.trashTimers.delete(path);
    }
  }

  // --- what the view draws ------------------------------------------------

  iconFor(path: string): string | undefined {
    return entryFor(this.store.data(), path)?.icon;
  }

  isPinned(path: string): boolean {
    return entryFor(this.store.data(), path)?.pinnedAt !== undefined;
  }

  /**
   * Whether the row is held at the top of its folder.
   *
   * What the tree marks, because it is the mark that explains the row's place.
   * A pin draws a row above the tree and says nothing about this one.
   */
  isKept(path: string): boolean {
    return entryFor(this.store.data(), path)?.keptAt !== undefined;
  }

  /** Put the pinned block in a new order, as a drag has just arranged it. */
  reorderPinned(orderedPaths: readonly string[]): void {
    this.store.mutate((data, now) => reorderPinned(data, orderedPaths, now));
  }

  /** Put the items held at the top of one folder in a new order, as a drag has just arranged them. */
  reorderKept(orderedPaths: readonly string[]): void {
    this.store.mutate((data, now) => reorderKept(data, orderedPaths, now));
  }

  /**
   * What the pinned section draws: every pinned item that still exists, in the
   * order it was pinned. A path whose file is gone is skipped rather than
   * dropped from the state, because it may be a move sync has not delivered yet.
   * A tag always exists: a tag no note carries any more is still the question
   * somebody pinned, and its row answers it with nothing open.
   */
  pinnedItems(): PinnedItem[] {
    const items: PinnedItem[] = [];

    for (const key of pinnedPaths(this.store.data())) {
      const tag = tagFromPinKey(key);
      if (tag !== null) {
        items.push({ kind: "tag", key, tag });
        continue;
      }
      if (this.isTrashed(key)) continue;
      const file = this.app.vault.getAbstractFileByPath(key);
      if (file) items.push({ kind: "file", key, file });
    }

    return items;
  }

  // --- tags ---------------------------------------------------------------

  /** The tasks under each tag, from the metadata cache, in one pass. */
  tagTallies(tags: readonly string[]): Map<string, TaskTally> {
    return tallyTags(this.taggedNotes(), tags);
  }

  /** Every note carrying a tag, as the sidebar lists them. */
  tagCards(tag: string): TagCard[] {
    const cards: TagCard[] = [];

    for (const note of this.taggedNotes()) {
      if (!noteHasTag(note, tag)) continue;
      const file = this.app.vault.getAbstractFileByPath(note.path);
      if (!(file instanceof TFile)) continue;

      cards.push({
        path: file.path,
        title: this.titleFor(file) ?? file.basename,
        folder: folderOf(file),
        tally: tallyTasks(note.items),
        modifiedAt: file.stat.mtime
      });
    }

    return sortTagCards(cards);
  }

  // --- related notes ------------------------------------------------------

  /**
   * The notes related to one note, as the sidebar lists them.
   *
   * The whole graph comes from `metadataCache.resolvedLinks`, which Obsidian
   * has already built and keeps current: every link in the vault, resolved to
   * the file it lands on. So this costs no file reads at all — the alternative,
   * reading every note to find its links, is the reason a feature like this
   * usually needs an index.
   *
   * Backlinks are inverted from the same table rather than asked for per note,
   * because Obsidian offers no public call for them and the walk is the same
   * walk either way.
   */
  relatedCards(path: string): RelatedCard[] {
    const started = performance.now();
    const { notes, degrees } = this.linkGraph();
    const related = rankRelated(path, notes, { degrees });

    const cards: RelatedCard[] = [];
    for (const entry of related) {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) continue;

      cards.push({
        path: file.path,
        title: this.titleFor(file) ?? file.basename,
        folder: folderOf(file),
        reasons: entry.reasons
      });
    }

    this.logger.debug(
      `Related notes for ${path}: ${cards.length} of ${notes.length} notes ` +
        `in ${Math.round(performance.now() - started)} ms`
    );
    return cards;
  }

  /**
   * What a row or a header calls a file: its frontmatter title when it has a
   * usable one, else its name. Null for a path the vault no longer holds.
   */
  displayTitle(path: string): string | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? (this.titleFor(file) ?? file.basename) : null;
  }

  /** The vault as the ranking wants it: every note with its links both ways. */
  private linkGraph(): { notes: RelatedSubject[]; degrees: LinkDegrees } {
    const resolved = this.app.metadataCache.resolvedLinks;
    const backlinks = backlinkIndex(resolved);
    // A note deleted a moment ago is off the list and off the tree; it must not
    // go on relating the notes it linked either, as a citer nobody can see.
    const present = (path: string): boolean => !this.isTrashed(path);

    const notes: RelatedSubject[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!present(file.path)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      notes.push({
        path: file.path,
        links: Object.keys(resolved[file.path] ?? {}).filter(present),
        backlinks: (backlinks.get(file.path) ?? []).filter(present),
        tags: relatedTags(cache ? getAllTags(cache) : null),
        folder: folderOf(file),
        modifiedAt: file.stat.mtime
      });
    }

    return { notes, degrees: linkDegrees(resolved) };
  }

  /** List the notes related to one note in the sidebar. */
  async openRelated(path: string): Promise<void> {
    await this.relatedOpener?.(path);
  }

  /** Lay a folder's pictures out as tiles, following the pane from then on. */
  async openFolderTiles(path: string): Promise<void> {
    await this.tilesOpener?.(path, true);
  }

  /**
   * The folder's pictures for the tile grid, or null when it is not a folder
   * any more.
   *
   * Asked here rather than in the view for one reason: a picture deleted a
   * moment ago is held back until the vault confirms it, and the grid must
   * not draw a tile for it in the meantime, any more than the tree draws a row.
   */
  folderTiles(path: string): FolderImages | null {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) return null;
    return folderImages(folder, { gone: (child) => this.isTrashed(child) });
  }

  /** Whether the folder at `path` has a picture of its own to show. */
  folderHasImages(path: string): boolean {
    const folder = this.app.vault.getAbstractFileByPath(path);
    return folder instanceof TFolder && hasFolderImages(folder, (child) => this.isTrashed(child));
  }

  /** The URL an <img> can load a vault file from, or null when it is not there. */
  resourceUrl(path: string): string | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
  }

  /** The pane's own menu for a note a card stands for. */
  showMenuForPath(path: string, event: MouseEvent | { x: number; y: number }): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) this.showMenu(file, event);
  }

  /** List a tag's notes in the sidebar. */
  async openTag(tag: string): Promise<void> {
    await this.tagOpener?.(tag);
  }

  /**
   * Pin a tag, unless it is pinned already under any spelling.
   *
   * Obsidian treats `#Projekt` and `#projekt` as one tag, so two rows for them
   * would be one question asked twice.
   */
  pinTag(raw: string): void {
    const key = tagPinKey(raw);
    const tag = key === null ? null : tagFromPinKey(key);
    if (key === null || tag === null) return;

    const already = pinnedPaths(this.store.data()).some(
      (pinned) => tagFromPinKey(pinned)?.toLowerCase() === tag.toLowerCase()
    );
    if (already) {
      new Notice(t().common.notice(t().explorer.tags.alreadyPinned(tag)));
      return;
    }

    this.store.mutate((data, now) => setPinned(data, key, true, now));
    new Notice(t().common.notice(t().explorer.tags.pinned(tag)));
  }

  /**
   * Offer the tags to pin: the vault's, or one note's.
   *
   * A note's own tags are what its menu offers, because the person pressing it
   * has already said which note they mean.
   */
  chooseTag(file?: TFile): void {
    const cache = file ? this.app.metadataCache.getFileCache(file) : null;
    const notes = file ? [{ tags: (cache && getAllTags(cache)) ?? [] }] : this.taggedNotes();
    const tags = vaultTags(notes);

    if (tags.length === 0) {
      new Notice(t().common.notice(t().explorer.tags.none));
      return;
    }

    new TagPickerModal(this.app, tags, (tag) => this.pinTag(tag)).open();
  }

  showTagMenu(
    item: { key: string; tag: string },
    event: MouseEvent | { x: number; y: number }
  ): void {
    const menu = new Menu();

    for (const entry of buildTagPinMenu()) {
      menu.addItem((menuItem) =>
        menuItem
          .setTitle(entry.label)
          .setIcon(entry.icon)
          .onClick(() => {
            if (entry.id === "show-tag") {
              void this.openTag(item.tag);
              return;
            }
            this.store.mutate((data, now) => setPinned(data, item.key, false, now));
          })
      );
    }

    this.openMenu = menu;
    menu.onHide(() => {
      if (this.openMenu === menu) this.openMenu = null;
    });

    if (event instanceof MouseEvent) menu.showAtMouseEvent(event);
    else menu.showAtPosition(event);
  }

  /** Every Markdown note with the tags and list items the cache holds for it. */
  private *taggedNotes(): Generator<TaggedNote> {
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.isTrashed(file.path)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;
      // A note that declines its task count keeps its tasks out of a pinned
      // tag's sum as well; it is still listed under the tag.
      const items = countsTasks(cache.frontmatter) ? cache.listItems : undefined;
      yield { path: file.path, tags: getAllTags(cache) ?? [], items };
    }
  }

  /**
   * The sync mark for a note.
   *
   * Nothing is shown while document sync is switched off: a vault that does not
   * mirror anything should not carry marks explaining that it does not.
   */
  badgeFor(file: TFile): SyncBadge {
    if (!this.getSettings().syncEnabled || file.extension !== "md") return "none";

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!hasSourceBinding(frontmatter)) return "none";

    const record = this.getSettings().syncState[file.path];
    return syncBadgeFor({
      bound: true,
      sourceValid: resolveSourceUrl(frontmatter?.[SYNC_FRONTMATTER_KEY]).ok,
      ...(record ? { record } : {})
    });
  }

  /** Whether a note is marked for publication, and whether that has happened. */
  publishMarkOf(file: TFile): PublishMark {
    if (file.extension !== "md") return { state: "none" };
    const settings = this.getSettings();
    if (settings.publishAccounts.length === 0) return { state: "none" };

    return publishMarkFor({
      path: file.path,
      frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter,
      accounts: settings.publishAccounts,
      keys: settings.publishFrontmatterKeys,
      lastRuns: settings.publishLastRun
    });
  }

  /**
   * What a note calls itself, or null when it says nothing.
   *
   * Read from the frontmatter's `title`, which is the key everything else that
   * reads Markdown uses for this. The file is never touched: a title is what a
   * note is called, a filename is where it lives, and renaming one to match the
   * other would move the file and rewrite every link into it.
   */
  titleFor(file: TAbstractFile): string | null {
    if (!(file instanceof TFile) || file.extension !== "md") return null;

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return frontmatterTitle(frontmatter?.title);
  }

  /**
   * Whether the note names a source.
   *
   * Separate from the badge on purpose: the badge answers "what is this mirror
   * doing", which is nothing at all while document sync is off, and the menu
   * has to keep offering a bound note the way out of that.
   */
  private isBound(file: TFile): boolean {
    if (file.extension !== "md") return false;
    return hasSourceBinding(this.app.metadataCache.getFileCache(file)?.frontmatter);
  }

  /** How many changes the poll saw and nobody has looked at yet. */
  pendingChangesFor(file: TFile): number {
    return this.getSettings().syncState[file.path]?.pendingChanges ?? 0;
  }

  /** When the note's source was last checked, as a line for a tooltip. */
  lastCheckedFor(file: TFile): string {
    const record = this.getSettings().syncState[file.path];
    if (!record || record.checkedAt === 0) return t().explorer.badge.never;
    return t().explorer.badge.checkedAt(new Date(record.checkedAt).toLocaleString());
  }

  // --- the menu -----------------------------------------------------------

  showMenu(file: TAbstractFile, event: MouseEvent | { x: number; y: number }): void {
    const menu = new Menu();
    const mode = this.foreignMode();
    const sections = buildExplorerMenu(this.describe(file), mode);

    sections.forEach((section, index) => {
      if (index > 0) menu.addSeparator();
      for (const item of section.items) {
        if (item.id === "more") {
          this.addForeignItems(menu, file, item, mode);
          continue;
        }
        menu.addItem((entry) => this.fill(entry, item, file));
      }
    });

    this.openMenu = menu;
    menu.onHide(() => {
      if (this.openMenu === menu) this.openMenu = null;
    });

    if (event instanceof MouseEvent) {
      menu.showAtMouseEvent(event);
    } else {
      menu.showAtPosition(event);
    }
  }

  /**
   * Take the menu away.
   *
   * A press on a touch screen opens this menu at half a second, and the same
   * press, kept moving, is how a row is dragged: the menu asked for by holding
   * still is not the menu you want once you have started moving.
   */
  closeMenu(): void {
    this.openMenu?.hide();
    this.openMenu = null;
  }

  private fill(entry: MenuItem, item: ExplorerMenuItem, file: TAbstractFile): void {
    entry
      .setTitle(item.label)
      .setIcon(item.icon)
      .onClick(() => this.reported(this.run(item.id, file), `${item.id} on ${file.path}`));
    if (item.warning) entry.setWarning(true);
  }

  /**
   * A menu action nobody awaits: a menu returns before the work does, and
   * what fails after that used to fail in silence, as an unhandled rejection
   * in the console and nothing on screen.
   */
  private reported(work: Promise<unknown>, what: string): void {
    work.catch((error: unknown) => {
      this.logger.warn(`Explorer action ${what} failed:`, error);
      const detail = error instanceof Error ? error.message : String(error);
      new Notice(t().common.notice(t().explorer.menu.actionFailed(detail)));
    });
  }

  /**
   * Let every other plugin contribute, in one place.
   *
   * The pane fires Obsidian's own `file-menu` event, so a plugin that adds
   * something to the file explorer's menu adds it here too, without knowing
   * this pane exists. The difference is where its items land: inside one
   * submenu at the end rather than scattered between the actions.
   */
  private addForeignItems(
    menu: Menu,
    file: TAbstractFile,
    item: ExplorerMenuItem,
    mode: ForeignItemMode
  ): void {
    if (mode === "inline" || !this.supportsSubmenus()) {
      this.app.workspace.trigger("file-menu", menu, file, FOREIGN_MENU_SOURCE);
      return;
    }

    menu.addItem((entry) => {
      entry.setTitle(item.label).setIcon(item.icon);
      const submenu = openSubmenu(entry, this.logger);
      if (submenu) this.app.workspace.trigger("file-menu", submenu, file, FOREIGN_MENU_SOURCE);
    });
  }

  private supportsSubmenus(): boolean {
    if (this.submenusSupported !== null) return this.submenusSupported;

    let supported = false;
    new Menu().addItem((entry) => {
      supported = typeof (entry as unknown as { setSubmenu?: unknown }).setSubmenu === "function";
    });

    this.submenusSupported = supported;
    return supported;
  }

  private foreignMode(): ForeignItemMode {
    return this.getSettings().explorerForeignMenu;
  }

  private describe(file: TAbstractFile): ExplorerTarget {
    const isFile = file instanceof TFile;
    const ai = hasApiKey(this.app.secretStorage, this.getSettings().llmSecretName);

    return {
      kind: isFile ? "file" : "folder",
      path: file.path,
      markdown: isFile && file.extension === "md",
      image: isFile && getImageMimeType(file.extension) !== null,
      csv: isFile && isCsvExtension(file.extension),
      describable:
        ai &&
        this.getSettings().imageDescriptionsEnabled &&
        (isFile ? this.describer : this.folderDescriber) !== null,
      ai,
      bound: isFile && this.isBound(file),
      hasIcon: this.iconFor(file.path) !== undefined,
      kept: this.isKept(file.path),
      pinned: this.isPinned(file.path),
      tagged: isFile && file.extension === "md" && this.hasTags(file),
      hasBoundNotes: file instanceof TFolder && this.hasBoundNotes(file),
      // Its own pictures, not its subfolders': the entry opens a grid of this
      // folder, and a grid of nothing is worse than no entry.
      hasImages: file instanceof TFolder && hasFolderImages(file, (path) => this.isTrashed(path)),
      windows: Platform.isDesktopApp
    };
  }

  private hasTags(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache !== null && (getAllTags(cache)?.length ?? 0) > 0;
  }

  /**
   * Whether this folder holds a note bound to a source.
   *
   * Walked from the folder rather than across the vault: the menu asks this
   * every time it opens on a folder, and listing every Markdown file in the
   * vault to keep the few under one folder cost the whole vault per press.
   */
  private hasBoundNotes(folder: TFolder): boolean {
    return someFileUnder(folder, (file) => file instanceof TFile && this.isBound(file));
  }

  // --- the actions --------------------------------------------------------

  async run(action: ExplorerAction, file: TAbstractFile): Promise<void> {
    switch (action) {
      case "open":
        return this.open(file, false);
      case "open-new-tab":
        return this.open(file, "tab");
      case "open-new-window":
        return this.open(file, "window");
      case "set-icon":
        return this.chooseIcon(file);
      case "clear-icon":
        this.store.mutate((data, now) => setIcon(data, file.path, null, now));
        return;
      case "keep-top":
      case "release-top":
        this.store.mutate((data, now) => setKept(data, file.path, action === "keep-top", now));
        return;
      case "pin":
      case "unpin":
        this.store.mutate((data, now) => setPinned(data, file.path, action === "pin", now));
        return;
      case "pin-tag":
        if (file instanceof TFile) this.chooseTag(file);
        return;
      case "related":
        if (file instanceof TFile) await this.openRelated(file.path);
        return;
      case "show-images":
        if (file instanceof TFolder) await this.openFolderTiles(file.path);
        return;
      case "bind-source":
        return this.bindSource(file);
      case "unbind-source":
        return this.unbindSource(file);
      case "check-source":
        return this.checkSource(file);
      case "open-source":
        return this.openSource(file);
      case "sync-folder":
        return this.checkFolder(file);
      case "new-note":
        return this.create(file, "note");
      case "new-folder":
        return this.create(file, "folder");
      case "copy-path":
        return this.copyPath(file);
      case "copy-csv-table":
        return this.copyCsvTable(file);
      case "move":
        return this.moveTo(file);
      case "rename":
        return this.rename(file);
      case "rename-ai":
        return this.renameByContent(file);
      case "describe-image":
        return file instanceof TFile ? this.describer?.(file) : undefined;
      case "describe-folder":
        return file instanceof TFolder ? this.folderDescriber?.(file) : undefined;
      case "delete":
        return this.remove(file);
      default:
        return;
    }
  }

  /** Open a file where a press or a menu asked: in place, a tab, a split or a window. */
  async open(file: TAbstractFile, where: PaneTarget): Promise<void> {
    if (!(file instanceof TFile)) return;
    await openInPane(this.app, file, where);
  }

  /**
   * The folder's `vault://` URL, on the clipboard.
   *
   * A folder is bookmarked by pasting this into the bookmarks file, so the path
   * has to be obtainable without typing it out and without a typo.
   */
  private async copyPath(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFolder)) return;

    const words = t().explorer.bookmarks;
    await copyText(
      vaultUrlFor(file.path),
      { copied: words.copied(file.path), failed: words.copyFailed },
      this.logger
    );
  }

  /**
   * A spreadsheet export, on the clipboard as a Markdown table.
   *
   * The size is checked before the file is read: a file too long to paste is
   * refused from its stat alone, without holding a megabyte in memory first.
   */
  private async copyCsvTable(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || !isCsvExtension(file.extension)) return;

    const words = t().explorer.csv;
    if (file.stat.size > MAX_CSV_BYTES) {
      new Notice(t().common.notice(words.tooLarge(Math.round(MAX_CSV_BYTES / 1000))));
      return;
    }

    let text: string;
    try {
      text = await this.app.vault.cachedRead(file);
    } catch (error) {
      this.logger.warn(`Could not read ${file.path}:`, error);
      new Notice(t().common.notice(words.readFailed));
      return;
    }

    const outcome = csvToMarkdown(text, words.column);
    if (!outcome.ok) {
      new Notice(t().common.notice(csvRefusal(outcome.reason)));
      return;
    }

    await copyText(
      outcome.markdown,
      { copied: words.copied(outcome.rows, outcome.columns), failed: words.copyFailed },
      this.logger,
      `the table from ${file.path}`
    );
  }

  private chooseIcon(file: TAbstractFile): void {
    new IconPickerModal(this.app, this.iconFor(file.path), (icon) => {
      this.store.mutate((data, now) => setIcon(data, file.path, icon, now));
    }).open();
  }

  // --- sync ---------------------------------------------------------------

  private bindSource(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;

    const current = this.app.metadataCache.getFileCache(file)?.frontmatter?.[SYNC_FRONTMATTER_KEY];

    new PromptModal(
      this.app,
      {
        title: t().explorer.bind.title,
        description: t().explorer.bind.desc,
        placeholder: t().explorer.bind.placeholder,
        initial: typeof current === "string" ? current : "",
        submitLabel: t().explorer.bind.submit,
        validate: (value) => {
          const resolved = resolveSourceUrl(value);
          return resolved.ok ? null : resolved.reason;
        }
      },
      (value) => this.reported(this.writeBinding(file, value), `binding ${file.path}`)
    ).open();
  }

  private async writeBinding(file: TFile, value: string): Promise<void> {
    const resolved = resolveSourceUrl(value);
    if (!resolved.ok) return;

    // The resolved URL is stored, not what was typed: a GitHub page link is
    // rewritten to its raw form once, here, rather than on every fetch.
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter[SYNC_FRONTMATTER_KEY] = resolved.url;
    });

    new Notice(t().common.notice(t().explorer.bind.bound(file.basename)));
    await this.checkSource(file);
  }

  private async unbindSource(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile)) return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      delete frontmatter[SYNC_FRONTMATTER_KEY];
    });
    // The baseline described a mirror that no longer exists; leaving it behind
    // would make a later re-binding compare against a stale hash.
    await this.sync.forget(file.path);

    new Notice(t().common.notice(t().explorer.bind.unbound(file.basename)));
    this.emit();
  }

  private async checkSource(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile)) return;

    const summary = await this.sync.checkFile(file);
    new Notice(
      t().common.notice(describePollSummary(summary, { scope: "note", name: file.basename }))
    );
    this.emit();
  }

  private async checkFolder(file: TAbstractFile): Promise<void> {
    const summary = await this.sync.checkFolder(file.path);
    new Notice(t().common.notice(describePollSummary(summary, { scope: "folder" })));
    this.emit();
  }

  private openSource(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;

    const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.[SYNC_FRONTMATTER_KEY];
    const resolved = resolveSourceUrl(raw);

    if (!resolved.ok) {
      new Notice(t().common.notice(t().explorer.bind.noSource));
      return;
    }
    window.open(resolved.url, "_blank");
  }

  // --- files and folders --------------------------------------------------

  private create(file: TAbstractFile, kind: "note" | "folder"): void {
    const parent = file instanceof TFolder ? file.path : (file.parent?.path ?? "");

    new PromptModal(
      this.app,
      {
        title: kind === "note" ? t().explorer.create.noteTitle : t().explorer.create.folderTitle,
        placeholder: t().explorer.create.namePlaceholder,
        submitLabel:
          kind === "note" ? t().explorer.create.noteTitle : t().explorer.create.folderTitle,
        validate: (value) => this.validateName(value, parent, kind === "note" ? ".md" : "")
      },
      (value) => void this.createIn(parent, value.trim(), kind)
    ).open();
  }

  private async createIn(parent: string, name: string, kind: "note" | "folder"): Promise<void> {
    const path = joinPath(parent, kind === "note" ? `${name}.md` : name);

    try {
      if (kind === "folder") {
        await this.app.vault.createFolder(path);
        return;
      }
      const created = await this.app.vault.create(path, "");
      await this.open(created, false);
    } catch (error) {
      this.logger.warn(`Could not create ${path}:`, error);
      new Notice(t().common.notice(t().explorer.create.invalid));
    }
  }

  /**
   * The same dialog, opened on a name the model proposed.
   *
   * The proposal is a suggestion and not a decision: it arrives in the field
   * with the file's own name replaced, where it can be read, corrected or
   * simply cancelled. A menu acts on a row in a tree rather than on the note in
   * front of you, which is no place for a rename that just happens.
   *
   * Nothing is said here when no name comes back. Whoever could not be served
   * has already been told which of the reasons it was.
   */
  private async renameByContent(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || !this.namer) return;

    const notice = new Notice(t().common.notice(t().explorer.menu.renaming), 0);
    let proposed: string | null;
    try {
      proposed = await this.namer(file);
    } finally {
      notice.hide();
    }

    // Renamed, moved or deleted while the request was in flight: the dialog
    // would be about a file that is no longer there.
    if (proposed === null || this.app.vault.getAbstractFileByPath(file.path) === null) return;

    this.rename(file, proposed);
  }

  private rename(file: TAbstractFile, proposed?: string): void {
    const parent = file.parent?.path ?? "";
    // The part the pane shows is the part a rename edits; the rest — `.md`,
    // `.excalidraw.md`, `.svg` — is kept, so a drawing stays a drawing.
    const parts = file instanceof TFile ? fileNameParts(file.name, file.extension) : null;
    const extension = parts?.suffix ?? "";
    const current = parts?.stem ?? file.name;
    const initial = proposed ?? current;

    new PromptModal(
      this.app,
      {
        title: t().explorer.create.renameTitle,
        initial,
        submitLabel: t().explorer.create.renameTitle,
        validate: (value) =>
          value === current ? null : this.validateName(value, parent, extension)
      },
      (raw) => {
        const value = raw.trim();
        if (value === current) return;
        void this.app.fileManager
          .renameFile(file, joinPath(parent, `${value}${extension}`))
          .catch((error: unknown) => {
            this.logger.warn(`Could not rename ${file.path}:`, error);
            new Notice(t().common.notice(t().explorer.create.invalid));
          });
      }
    ).open();
  }

  /**
   * Moving, without a mouse.
   *
   * The tree's drag needs one, and on a phone the long press opens this menu,
   * so a list of folders is the only way anything can be moved there. Only
   * destinations that would be accepted are offered, and the move goes through
   * Obsidian's own rename, so links follow it.
   */
  private moveTo(file: TAbstractFile): void {
    const destinations = moveDestinations(file.path, this.moveContext());

    if (destinations.length === 0) {
      new Notice(t().common.notice(t().explorer.move.nowhere(file.name)));
      return;
    }

    this.pickFolder(destinations, t().explorer.move.title(file.name), (folder) =>
      this.reported(this.moveAll([file], folder), `moving ${file.path}`)
    );
  }

  /**
   * Every path in the vault, and which of them are folders.
   *
   * The root is left out: it is the empty string everywhere a move is decided,
   * never the "/" Obsidian gives its own root folder.
   */
  private moveContext(): MoveContext {
    const taken = new Set<string>();
    const folders = new Set<string>();
    const root = this.app.vault.getRoot();

    for (const entry of this.app.vault.getAllLoadedFiles()) {
      if (entry === root) continue;
      taken.add(entry.path);
      if (entry instanceof TFolder) folders.add(entry.path);
    }

    return { taken, folders };
  }

  private remove(file: TAbstractFile): void {
    const inside = file instanceof TFolder ? countChildren(file) : 0;

    this.confirm(
      {
        title: t().explorer.delete.title,
        message:
          file instanceof TFolder
            ? t().explorer.delete.folderConfirm(file.name, inside)
            : t().explorer.delete.confirm(file.name),
        submitLabel: t().explorer.delete.submit
      },
      () => this.reported(this.trashAll([file]), `deleting ${file.path}`)
    );
  }

  /** Delete several rows at once: one question, one trash call each. */
  removeMany(selected: TAbstractFile[]): void {
    const files = topLevel(selected);
    if (files.length === 0) return;
    if (files.length === 1 && files[0]) return this.remove(files[0]);

    this.confirm(
      {
        title: t().explorer.delete.title,
        message: t().explorer.delete.manyConfirm(files.length),
        submitLabel: t().explorer.delete.submit
      },
      () => this.reported(this.trashAll(files), `deleting ${files.length} rows`)
    );
  }

  /**
   * Trash each file, take its row away, and offer to put them all back.
   *
   * Trashed, never erased: which trash is the user's own setting, and a
   * wrong tap in a file list must be undoable. Undoable by this pane too,
   * when the trash is the vault's own: the adapter can see into `.trash`
   * and move a file out again. The system trash it cannot see into, and
   * the notice says so rather than offering an undo that would do nothing.
   */
  private async trashAll(requested: TAbstractFile[]): Promise<void> {
    const steps: DeleteStep[] = [];
    let localTrash = true;
    // A described picture takes its description note along, in the same
    // batch, so one undo brings both back.
    const asked = new Set(requested.map((file) => file.path));
    const files = [...requested, ...this.descriptionsOf(requested, asked)];

    // The rows go before the trash call, not after it. The vault's own
    // delete event is what the pane listens to, and it arrives when a
    // watcher notices rather than when the file went — seconds later on a
    // phone. The trash call itself can take as long: a system trash on a
    // slow volume, a vault on a synced drive. A row sitting there for those
    // seconds after a confirmed delete reads as a pane that froze. So the
    // rows go the moment the person confirmed, and the call and the event,
    // when they come, only confirm it; a call that fails brings its row back.
    for (const file of files) this.holdTrashed(file.path);
    this.emit();

    for (const file of files) {
      const path = file.path;
      let receipt: string | null;
      try {
        receipt = await this.trashWithReceipt(file);
      } catch (error) {
        this.logger.warn(`Could not delete ${path}:`, error);
        // A row that stays put after a confirmed delete otherwise reads as
        // the pane having missed the change rather than the delete failing.
        new Notice(t().common.notice(t().explorer.delete.failed(file.name)));
        this.forgetTrashed(path);
        this.emit();
        continue;
      }

      // The file is gone now, and the vault's event is what remains to wait for.
      this.startTrashGrace(path);
      if (receipt === null) localTrash = false;
      else steps.push({ from: path, trashedTo: receipt });
    }

    if (steps.length === 0 && !localTrash && requested.length > 0) {
      new Notice(t().common.notice(t().explorer.undo.systemTrash));
      return;
    }
    if (steps.length === 0) return;

    const action: UndoableAction = { kind: "delete", steps };
    this.undo.push(action, this.now());
    // The notice counts what the person chose; the notes came along unasked.
    const chosen = steps.filter((step) => asked.has(step.from));
    const message =
      chosen.length === 1 && chosen[0]
        ? t().explorer.delete.done(basename(chosen[0].from))
        : t().explorer.delete.manyDone(chosen.length);
    this.toast(t().common.notice(message), t().explorer.undo.action, () =>
      this.reported(this.undoAction(action), "undoing")
    );
  }

  /**
   * The description notes of the pictures among `files`, a folder's included,
   * less any note already chosen or inside a chosen folder — that one goes
   * with the folder, and trashing it twice would fail the second time.
   */
  private descriptionsOf(files: TAbstractFile[], chosen: Set<string>): TFile[] {
    const notes: TFile[] = [];
    const taken = new Set<string>();
    const goesAnyway = (path: string): boolean =>
      [...chosen].some((picked) => isAtOrUnder(path, picked));
    const consider = (picture: TFile): void => {
      if (picture.extension === "md") return;
      const path = this.descriptionNoteOf(picture.path);
      if (path === null || taken.has(path) || goesAnyway(path)) return;
      const note = this.app.vault.getAbstractFileByPath(path);
      if (!(note instanceof TFile)) return;
      taken.add(path);
      notes.push(note);
    };
    for (const file of files) {
      if (file instanceof TFile) consider(file);
      else if (file instanceof TFolder) for (const picture of filesUnder(file)) consider(picture);
    }
    return notes;
  }

  /** Take a row away on trust, until the vault confirms it or the grace runs out. */
  private holdTrashed(path: string): void {
    this.trashed.add(path);
  }

  /**
   * Start the outer limit on a held row, once its trash call has returned.
   *
   * Not before: the row stays away for as long as the call is under way,
   * however long that is. A delete event that arrived during the call has
   * already let the row go, and there is nothing left to limit.
   */
  private startTrashGrace(path: string): void {
    if (!this.trashed.has(path)) return;
    const earlier = this.trashTimers.get(path);
    if (earlier !== undefined) this.clearTimer(earlier);
    const handle = this.setTimer(() => {
      this.trashTimers.delete(path);
      if (!this.trashed.has(path)) return;
      this.forgetTrashed(path);
      this.emit();
    }, TRASH_GRACE_MS);
    this.trashTimers.set(path, handle);
  }

  /**
   * Trash the file and say where it went, or null for a trash the adapter
   * cannot see into.
   *
   * The vault's own trash keeps the file's name, so one look at that path
   * after the call is the receipt — once what is there has been checked to
   * be the file, and not a namesake something else put there meanwhile.
   * Listing the trash before and after was how it used to be found, and a
   * trash that is never emptied made every delete wait on two listings of
   * it; the listings are kept only for the one case they answer, a namesake
   * already there, which the trash renames around.
   */
  private async trashWithReceipt(file: TAbstractFile): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    const expected = localTrashPath(file.name);
    const shape: TrashedShape =
      file instanceof TFile
        ? { type: "file", size: file.stat.size, mtime: file.stat.mtime }
        : { type: "folder" };
    const taken = await adapter.exists(expected);
    const before = taken ? await this.listTrash(adapter) : null;

    await this.app.fileManager.trashFile(file);

    if (before === null) {
      return isTrashedEntry(shape, await adapter.stat(expected)) ? expected : null;
    }
    return arrivedReceipt(file.name, before, await this.listTrash(adapter));
  }

  private async listTrash(adapter: DataAdapter): Promise<string[]> {
    if (!(await adapter.exists(LOCAL_TRASH))) return [];
    const listed = await adapter.list(LOCAL_TRASH);
    return [...listed.files, ...listed.folders];
  }

  // --- undo ---------------------------------------------------------------

  /** Take back the last move or delete, if there still is one to take. */
  async undoLast(): Promise<void> {
    await this.perform(this.undo.take(this.now()));
  }

  /**
   * Take back one particular action — the one a notice offered.
   *
   * Only while it is still the one on offer: a notice about a delete, still
   * on screen after a move, must not undo the move.
   */
  async undoAction(action: UndoableAction): Promise<void> {
    await this.perform(this.undo.takeIf(action, this.now()));
  }

  private async perform(action: UndoableAction | null): Promise<void> {
    if (action === null) {
      new Notice(t().common.notice(t().explorer.undo.nothing));
      return;
    }

    if (action.kind === "move") {
      let undone = 0;
      // Last moved, first moved back: a folder moved after a file inside it
      // has to return before the file's old path exists again.
      for (const step of [...action.steps].reverse()) {
        const file = this.app.vault.getAbstractFileByPath(step.to);
        if (!file || this.app.vault.getAbstractFileByPath(step.from)) {
          new Notice(t().common.notice(t().explorer.undo.blocked(basename(step.from))));
          continue;
        }
        try {
          await this.app.fileManager.renameFile(file, step.from);
          undone += 1;
        } catch (error) {
          this.logger.warn(`Could not move ${step.to} back to ${step.from}:`, error);
          new Notice(t().common.notice(t().explorer.move.failed(basename(step.from))));
        }
      }
      if (undone > 0) new Notice(t().common.notice(t().explorer.undo.moveUndone(undone)));
      return;
    }

    const adapter = this.app.vault.adapter;
    let undone = 0;
    for (const step of [...action.steps].reverse()) {
      if (await adapter.exists(step.from)) {
        new Notice(t().common.notice(t().explorer.undo.blocked(basename(step.from))));
        continue;
      }
      try {
        await adapter.rename(step.trashedTo, step.from);
        // The vault will report the file's return; the pane need not wait.
        this.forgetTrashedAround(step.from);
        undone += 1;
      } catch (error) {
        this.logger.warn(`Could not restore ${step.trashedTo} to ${step.from}:`, error);
        new Notice(t().common.notice(t().explorer.undo.blocked(basename(step.from))));
      }
    }
    this.emit();
    if (undone > 0) new Notice(t().common.notice(t().explorer.undo.deleteUndone(undone)));
  }

  // --- the selection ------------------------------------------------------

  /** The menu on several rows at once. */
  showSelectionMenu(files: TAbstractFile[], event: MouseEvent | { x: number; y: number }): void {
    const menu = new Menu();
    for (const item of buildSelectionMenu(files.length)) {
      menu.addItem((entry) => this.fillSelection(entry, item, files));
    }

    this.openMenu = menu;
    menu.onHide(() => {
      if (this.openMenu === menu) this.openMenu = null;
    });
    if (event instanceof MouseEvent) menu.showAtMouseEvent(event);
    else menu.showAtPosition(event);
  }

  private fillSelection(entry: MenuItem, item: SelectionMenuItem, files: TAbstractFile[]): void {
    entry
      .setTitle(item.label)
      .setIcon(item.icon)
      .onClick(() => this.runSelection(item.id, files));
    if (item.warning) entry.setWarning(true);
  }

  runSelection(action: SelectionAction, files: TAbstractFile[]): void {
    switch (action) {
      case "delete-selected":
        return this.removeMany(files);
      case "move-selected":
        return this.moveManyTo(files);
      default:
        return;
    }
  }

  /**
   * Move several rows into one folder.
   *
   * Only folders every one of them could go to are offered: a destination
   * that is fine for four of five and refused for the fifth would be a list
   * that answers a choice with a partial failure.
   */
  private moveManyTo(selected: TAbstractFile[]): void {
    const files = topLevel(selected);
    if (files.length === 0) return;
    const context = this.moveContext();
    const shared = files
      .map((file) => new Set(moveDestinations(file.path, context)))
      .reduce<Set<string> | null>(
        (common, mine) =>
          common === null ? mine : new Set([...common].filter((f) => mine.has(f))),
        null
      );
    const destinations = shared ? [...shared] : [];

    if (destinations.length === 0) {
      new Notice(t().common.notice(t().explorer.move.nowhereMany));
      return;
    }

    this.pickFolder(destinations, t().explorer.move.manyTitle(files.length), (folder) =>
      this.reported(this.moveAll(files, folder), `moving ${files.length} rows`)
    );
  }

  /**
   * Move one file or folder into `folder`, as a drop or a menu does.
   *
   * Planned against the vault as it is now rather than when the drag began,
   * because a sync may have delivered something since. Landing where it
   * already was is the commonest refusal and is not worth a word; the rest
   * are said out loud.
   */
  async move(file: TAbstractFile, folder: string): Promise<void> {
    const plan = planMove(file.path, folder, this.moveContext());
    if (!isMovePlan(plan)) {
      if (plan !== "same-folder") {
        new Notice(t().common.notice(moveRefusalMessage(plan, file.name)));
      }
      return;
    }
    await this.moveAll([file], folder);
  }

  private async moveAll(files: TAbstractFile[], folder: string): Promise<void> {
    const steps: MoveStep[] = [];
    let refused = 0;
    const where = folder.length > 0 ? folder : t().explorer.move.root;

    for (const file of files) {
      // Checked again rather than trusted: the list was built when the menu
      // opened, and a sync may have delivered something since.
      const plan = planMove(file.path, folder, this.moveContext());
      if (!isMovePlan(plan)) {
        refused += 1;
        if (files.length === 1) {
          new Notice(t().common.notice(moveRefusalMessage(plan, file.name)));
        }
        continue;
      }
      const from = file.path;
      try {
        await this.app.fileManager.renameFile(file, plan.destination);
        steps.push({ from, to: plan.destination });
      } catch (error) {
        this.logger.warn(`Could not move ${from}:`, error);
        refused += 1;
        new Notice(t().common.notice(t().explorer.move.failed(file.name)));
      }
    }

    if (steps.length === 0) return;
    const action: UndoableAction = { kind: "move", steps };
    this.undo.push(action, this.now());

    // The pane may be behind the note the move was started from, so the only
    // sign it happened would otherwise be a row that is no longer where it was.
    const message =
      files.length === 1 && steps[0]
        ? t().explorer.move.done(basename(steps[0].from), where)
        : t().explorer.move.manyDone(steps.length, where, refused);
    this.toast(t().common.notice(message), t().explorer.undo.action, () =>
      this.reported(this.undoAction(action), "undoing")
    );
  }

  // --- files from outside the vault ---------------------------------------

  /**
   * Write files dropped from the desktop into `folder`.
   *
   * Decided first, written second: `planImport` names every file's path or
   * its refusal before a byte is read, so a drop that is half folders and
   * half photos writes the photos and says what became of the folders.
   */
  async importFiles(sources: ImportSource[], folder: string): Promise<void> {
    const taken = new Set(this.app.vault.getAllLoadedFiles().map((entry) => entry.path));
    const plan = planImport(sources, folder, taken);

    let written = 0;
    for (const entry of plan.imports) {
      // By place in the drop, never by name: two files called Foto.jpg are
      // two files, and a lookup by name would write one of them twice.
      const source = sources[entry.index];
      if (!source) continue;
      try {
        await this.app.vault.createBinary(entry.path, await source.bytes());
        written += 1;
      } catch (error) {
        this.logger.warn(`Could not import ${entry.name} as ${entry.path}:`, error);
        new Notice(t().common.notice(t().explorer.import.failed(entry.name)));
      }
    }

    const where = folder.length > 0 ? folder : t().explorer.move.root;
    if (written > 0) new Notice(t().common.notice(t().explorer.import.done(written, where)));
    if (plan.refused.length > 0) {
      const lines = plan.refused.map((entry) => `${entry.name} — ${importReason(entry.reason)}`);
      new Notice(
        t().common.notice(
          `${t().explorer.import.refused(plan.refused.length)}\n${lines.join("\n")}`
        )
      );
    }
  }

  /**
   * Why a name cannot be used, as a line under the field, or null.
   *
   * Every rule the vault will apply is applied here first, so the dialog
   * never approves a name the create then refuses with a shrug.
   */
  private validateName(value: string, parent: string, extension: string): string | null {
    const checked = checkFileName(value);
    if (!checked.ok) return this.nameProblem(checked.problem);

    const path = joinPath(parent, `${checked.name}${extension}`);
    return this.app.vault.getAbstractFileByPath(path) ? t().explorer.create.exists : null;
  }

  private nameProblem(problem: FileNameProblem): string {
    const create = t().explorer.create;
    switch (problem) {
      case "characters":
        return create.badCharacters;
      case "link-characters":
        return create.linkCharacters;
      case "hidden":
        return create.hidden;
      case "trailing-dot":
        return create.trailingDot;
      case "too-long":
        return create.tooLong;
      case "reserved":
        return create.reserved;
      default:
        return create.invalid;
    }
  }

  private allPaths(): string[] {
    const paths: string[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of folder.children) {
        paths.push(child.path);
        if (child instanceof TFolder) walk(child);
      }
    };
    walk(this.app.vault.getRoot());
    return paths;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function joinPath(parent: string, name: string): string {
  return parent.length > 0 ? `${parent}/${name}` : name;
}

/** The selection without anything inside a selected folder; see `topLevelOnly`. */
function topLevel(files: TAbstractFile[]): TAbstractFile[] {
  const keep = new Set(topLevelOnly(files.map((file) => file.path)));
  return files.filter((file) => keep.has(file.path));
}

function importReason(reason: ImportRefusal): string {
  const messages = t().explorer.import;
  switch (reason) {
    case "folder":
      return messages.reasonFolder;
    case "too-large":
      return messages.reasonTooLarge;
    case "bad-name":
      return messages.reasonBadName;
    default:
      return messages.reasonTooMany;
  }
}

function filesUnder(folder: TFolder): TFile[] {
  return folder.children.flatMap((child) =>
    child instanceof TFolder ? filesUnder(child) : child instanceof TFile ? [child] : []
  );
}

function countChildren(folder: TFolder): number {
  return folder.children.reduce(
    (total, child) => total + 1 + (child instanceof TFolder ? countChildren(child) : 0),
    0
  );
}

function csvRefusal(reason: CsvRefusal): string {
  const words = t().explorer.csv;
  switch (reason) {
    case "empty":
      return words.empty;
    case "malformed":
      return words.malformed;
    case "too-many-rows":
      return words.tooManyRows(MAX_CSV_ROWS);
    case "too-many-columns":
      return words.tooManyColumns(MAX_CSV_COLUMNS);
  }
}
