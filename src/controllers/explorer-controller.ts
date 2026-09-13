/**
 * Everything the explorer pane does that touches Obsidian.
 *
 * The pane itself only draws. This is where the state file is opened, vault
 * events are followed, the context menu is assembled, and the sync actions are
 * carried out — which is the reason the pane exists at all. Binding a note to a
 * source and refreshing it belong next to the note, not only in the command
 * palette, and a folder can refresh everything under it in one go.
 */
import { Menu, Notice, TAbstractFile, TFile, TFolder, type App, type MenuItem } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import type { SchreibstubeSettings } from "../types";
import { syncBadgeFor, type SyncBadge } from "../services/explorer-badge";
import {
  buildExplorerMenu,
  type ExplorerAction,
  type ExplorerMenuItem,
  type ExplorerTarget,
  type ForeignItemMode
} from "../services/explorer-menu";
import {
  entryFor,
  markMissing,
  pinnedPaths,
  reattachOrphans,
  renamePath,
  setIcon,
  reorderPinned,
  setKept,
  setPinned,
  type ExplorerData
} from "../services/explorer-state";
import { ExplorerStore, type ExplorerFileStore } from "../services/explorer-store";
import { vaultUrlFor } from "../services/bookmark-file";
import { frontmatterTitle } from "../services/note-title";
import {
  isMovePlan,
  isUnder,
  moveDestinations,
  moveRefusalMessage,
  planMove,
  type MoveContext
} from "../services/tree-move";
import { hasSourceBinding, resolveSourceUrl, SYNC_FRONTMATTER_KEY } from "../services/sync-source";
import { openSubmenu } from "../services/workspace-internals";
import type { PollSummary } from "./proofread-controller";
import { ConfirmModal, FolderPickerModal, PromptModal } from "../ui/explorer-modals";
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
 * the trash call returns, and this is the outer limit on that: if no delete
 * event ever arrives, the row comes back rather than a file being hidden by a
 * plugin that was only ever guessing.
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

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly sync: ExplorerSyncBridge,
    private readonly logger: Logger,
    stateFile: ExplorerFileStore
  ) {
    this.store = new ExplorerStore({ file: stateFile, logger });
    this.store.onChange(() => this.emit());
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
    this.listeners.clear();
  }

  /** Called whenever icons or pins changed, from any device. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  data(): ExplorerData {
    return this.store.data();
  }

  /** Pick up a write from another device. Cheap: a modification-time check. */
  async checkForExternalChange(): Promise<void> {
    await this.store.refreshFromDisk();
  }

  // --- vault events -------------------------------------------------------

  handleRename(file: TAbstractFile, oldPath: string): void {
    this.store.mutate((data, now) => renamePath(data, oldPath, file.path, now));
  }

  handleDelete(file: TAbstractFile): void {
    // The vault has caught up with what the pane already drew.
    this.forgetTrashed(file.path);
    this.store.mutate((data, now) => markMissing(data, file.path, now));
    // Not every delete changes the state file — a note with no icon and no
    // mark changes nothing — and the pane still has a row to take away.
    this.emit();
  }

  /** A file appearing may be one that moved outside Obsidian, so it can claim
   *  the icon of a tombstone with the same name. */
  handleCreate(file: TAbstractFile): void {
    // A path written again is a path that exists, whatever was trashed there.
    this.forgetTrashed(file.path);
    this.store.mutate((data, now) => reattachOrphans(data, [file.path], now));
  }

  /**
   * Whether the pane should act as though this path were already gone.
   *
   * True between the trash call returning and the vault reporting the
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

  /** Drop a path and everything under it from what is being held back. */
  private forgetTrashed(path: string): void {
    if (this.trashed.size === 0) return;

    const prefix = `${path}/`;
    for (const gone of [...this.trashed]) {
      if (gone === path || gone.startsWith(prefix)) this.trashed.delete(gone);
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

  /**
   * What the pinned section draws: every pinned item that still exists, in the
   * order it was pinned. A path whose file is gone is skipped rather than
   * dropped from the state, because it may be a move sync has not delivered yet.
   */
  /** Put the pinned block in a new order, as a drag has just arranged it. */
  reorderPinned(orderedPaths: readonly string[]): void {
    this.store.mutate((data, now) => reorderPinned(data, orderedPaths, now));
  }

  pinnedItems(): TAbstractFile[] {
    const items: TAbstractFile[] = [];

    for (const path of pinnedPaths(this.store.data())) {
      if (this.isTrashed(path)) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) items.push(file);
    }

    return items;
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

    return syncBadgeFor({
      bound: true,
      sourceValid: resolveSourceUrl(frontmatter?.[SYNC_FRONTMATTER_KEY]).ok,
      record: this.getSettings().syncState[file.path]
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
      .onClick(() => void this.run(item.id, file));
    if (item.warning) entry.setWarning(true);
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

  /** Probed once: older Obsidian versions have no submenus at all. */
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

    return {
      kind: isFile ? "file" : "folder",
      path: file.path,
      markdown: isFile && file.extension === "md",
      bound: isFile && this.isBound(file),
      hasIcon: this.iconFor(file.path) !== undefined,
      kept: this.isKept(file.path),
      pinned: this.isPinned(file.path),
      hasBoundNotes: !isFile && this.hasBoundNotes(file.path)
    };
  }

  private hasBoundNotes(folderPath: string): boolean {
    const prefix = folderPath === "/" ? "" : `${folderPath}/`;
    return this.app.vault
      .getMarkdownFiles()
      .some(
        (file) =>
          file.path.startsWith(prefix) &&
          hasSourceBinding(this.app.metadataCache.getFileCache(file)?.frontmatter)
      );
  }

  // --- the actions --------------------------------------------------------

  async run(action: ExplorerAction, file: TAbstractFile): Promise<void> {
    switch (action) {
      case "open":
        return this.open(file, false);
      case "open-new-tab":
        return this.open(file, true);
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
      case "move":
        return this.moveTo(file);
      case "rename":
        return this.rename(file);
      case "delete":
        return this.remove(file);
      default:
        return;
    }
  }

  async open(file: TAbstractFile, newTab: boolean): Promise<void> {
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
    await leaf.openFile(file);
  }

  /**
   * The folder's `vault://` URL, on the clipboard.
   *
   * A folder is bookmarked by pasting this into the bookmarks file, so the path
   * has to be obtainable without typing it out and without a typo.
   */
  private copyPath(file: TAbstractFile): void {
    if (!(file instanceof TFolder)) return;

    const url = vaultUrlFor(file.path);

    void navigator.clipboard
      .writeText(url)
      .then(() => {
        new Notice(t().common.notice(t().explorer.bookmarks.copied(file.path)));
      })
      .catch((error: unknown) => {
        this.logger.warn(`Could not copy ${url} to the clipboard:`, error);
        new Notice(t().common.notice(t().explorer.bookmarks.copyFailed));
      });
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
      (value) => void this.writeBinding(file, value)
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
    new Notice(t().common.notice(this.describeSummary(summary, file.basename)));
    this.emit();
  }

  private async checkFolder(file: TAbstractFile): Promise<void> {
    const summary = await this.sync.checkFolder(file.path);

    new Notice(
      t().common.notice(
        summary.skipped === "disabled"
          ? t().sync.disabled
          : summary.skipped === "busy"
            ? t().sync.busy
            : summary.checked === 0 && summary.failed === 0
              ? t().explorer.bind.folderEmpty
              : t().explorer.bind.folderChecked(
                  summary.checked,
                  summary.withChanges,
                  summary.failed
                )
      )
    );
    this.emit();
  }

  private describeSummary(summary: PollSummary, name: string): string {
    // Why nothing happened comes first: a switch being off is not something the
    // note can be blamed for, and it is the only answer that says what to do.
    if (summary.skipped === "disabled") return t().sync.disabled;
    if (summary.skipped === "busy") return t().sync.busy;
    if (summary.failed > 0) return t().explorer.badge.error;
    if (summary.withChanges > 0) return t().sync.withUpdates(summary.withChanges);
    if (summary.checked === 0) return t().sync.notBound;
    return t().explorer.bind.checked(name);
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
      (value) => void this.createIn(parent, value, kind)
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

  private rename(file: TAbstractFile): void {
    const parent = file.parent?.path ?? "";
    const extension = file instanceof TFile && file.extension ? `.${file.extension}` : "";
    const initial = file instanceof TFile ? file.basename : file.name;

    new PromptModal(
      this.app,
      {
        title: t().explorer.create.renameTitle,
        initial,
        submitLabel: t().explorer.create.renameTitle,
        validate: (value) =>
          value === initial ? null : this.validateName(value, parent, extension)
      },
      (value) => {
        if (value === initial) return;
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

    new FolderPickerModal(this.app, destinations, t().explorer.move.title(file.name), (folder) => {
      // Checked again rather than trusted: the list was built when the menu
      // opened, and a sync may have delivered something since.
      const plan = planMove(file.path, folder, this.moveContext());
      if (!isMovePlan(plan)) {
        new Notice(t().common.notice(moveRefusalMessage(plan, file.name)));
        return;
      }

      const where = folder.length > 0 ? folder : t().explorer.move.root;
      void this.app.fileManager
        .renameFile(file, plan.destination)
        .then(() => {
          // The pane may be behind the note the move was started from, so the
          // only sign it happened would otherwise be a row that is no longer
          // where it was.
          new Notice(t().common.notice(t().explorer.move.done(file.name, where)));
        })
        .catch((error: unknown) => {
          this.logger.warn(`Could not move ${file.path}:`, error);
          new Notice(t().common.notice(t().explorer.move.failed(file.name)));
        });
    }).open();
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

    new ConfirmModal(
      this.app,
      {
        title: t().explorer.delete.title,
        message:
          file instanceof TFolder
            ? t().explorer.delete.folderConfirm(file.name, inside)
            : t().explorer.delete.confirm(file.name),
        submitLabel: t().explorer.delete.submit
      },
      () => {
        // Trashed, never erased: which trash is the user's own setting, and a
        // wrong tap in a file list must be undoable.
        void this.app.fileManager
          .trashFile(file)
          .then(() => {
            // The file is gone the moment this returns. The vault's own delete
            // event is what the pane listens to, and it arrives when a watcher
            // notices rather than when the file went — seconds later on a
            // phone, which is a row sitting there after you deleted it. So the
            // row goes now, and the event, when it comes, only confirms it.
            this.trashed.add(file.path);
            this.emit();

            window.setTimeout(() => {
              if (!this.trashed.has(file.path)) return;
              this.forgetTrashed(file.path);
              this.emit();
            }, TRASH_GRACE_MS);
          })
          .catch((error: unknown) => {
            this.logger.warn(`Could not delete ${file.path}:`, error);
            // A row that stays put after a confirmed delete otherwise reads as
            // the pane having missed the change rather than the delete failing.
            new Notice(t().common.notice(t().explorer.delete.failed(file.name)));
          });
      }
    ).open();
  }

  private validateName(value: string, parent: string, extension: string): string | null {
    if (value.length === 0 || /[\\/:]/.test(value)) return t().explorer.create.invalid;

    const path = joinPath(parent, `${value}${extension}`);
    return this.app.vault.getAbstractFileByPath(path) ? t().explorer.create.exists : null;
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

function countChildren(folder: TFolder): number {
  return folder.children.reduce(
    (total, child) => total + 1 + (child instanceof TFolder ? countChildren(child) : 0),
    0
  );
}
