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
  setPinned,
  type ExplorerData
} from "../services/explorer-state";
import { ExplorerStore, type ExplorerFileStore } from "../services/explorer-store";
import { vaultUrlFor } from "../services/bookmark-file";
import { hasSourceBinding, resolveSourceUrl, SYNC_FRONTMATTER_KEY } from "../services/sync-source";
import { openSubmenu } from "../services/workspace-internals";
import type { PollSummary } from "./proofread-controller";
import { ConfirmModal, PromptModal } from "../ui/explorer-modals";
import { IconPickerModal } from "../ui/icon-picker";

/** The file the pane's state lives in, inside the plugin's own folder. */
export const EXPLORER_STATE_FILE = "explorer.json";

/** How often the state file is checked for a write from another device. */
export const EXTERNAL_CHECK_MS = 15_000;

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
    this.store.mutate((data, now) => markMissing(data, file.path, now));
  }

  /** A file appearing may be one that moved outside Obsidian, so it can claim
   *  the icon of a tombstone with the same name. */
  handleCreate(file: TAbstractFile): void {
    this.store.mutate((data, now) => reattachOrphans(data, [file.path], now));
  }

  // --- what the view draws ------------------------------------------------

  iconFor(path: string): string | undefined {
    return entryFor(this.store.data(), path)?.icon;
  }

  isPinned(path: string): boolean {
    return entryFor(this.store.data(), path)?.pinnedAt !== undefined;
  }

  /**
   * What the pinned section draws: every pinned item that still exists, in the
   * order it was pinned. A path whose file is gone is skipped rather than
   * dropped from the state, because it may be a move sync has not delivered yet.
   */
  pinnedItems(): TAbstractFile[] {
    const items: TAbstractFile[] = [];

    for (const path of pinnedPaths(this.store.data())) {
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

    if (event instanceof MouseEvent) {
      menu.showAtMouseEvent(event);
    } else {
      menu.showAtPosition(event);
    }
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
      hasIcon: this.iconFor(file.path) !== undefined,
      pinned: this.isPinned(file.path),
      sync: isFile ? this.badgeFor(file) : "none",
      hasBoundNotes: !isFile && this.getSettings().syncEnabled && this.hasBoundNotes(file.path)
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
        summary.checked === 0 && summary.failed === 0
          ? t().explorer.bind.folderEmpty
          : t().explorer.bind.folderChecked(summary.checked, summary.withChanges, summary.failed)
      )
    );
    this.emit();
  }

  private describeSummary(summary: PollSummary, name: string): string {
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
   * The delete confirmation, reachable from the menu and from the trash button
   * a row shows on hover. Both go through here, so there is one dialog and one
   * place that decides what deleting means.
   */
  confirmDelete(file: TAbstractFile): void {
    this.remove(file);
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
        void this.app.fileManager.trashFile(file).catch((error: unknown) => {
          this.logger.warn(`Could not delete ${file.path}:`, error);
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
