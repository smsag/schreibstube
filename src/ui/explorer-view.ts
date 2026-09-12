/**
 * The Schreibstube file pane.
 *
 * Obsidian's own explorer cannot be reordered or decorated by a plugin without
 * fighting its sorter, and its context menu is whatever the installed plugins
 * happened to append. This pane is the same tree drawn by us, which buys three
 * things the vault otherwise cannot have: an icon per file and per folder, a
 * sync mark on notes that mirror a source, and a pinned block at the top of
 * every folder.
 *
 * Above the tree sit two lists that are not part of it. **Bookmarks** are links
 * to somewhere the tree cannot reach — a web page, an Obsidian URI, a folder, a
 * note — read from a Markdown file a person edits by hand. **Latest** is the
 * handful of notes written most recently. Both are read-only here: the pane
 * shows them and opens them, and nothing else.
 *
 * It draws and reports. Every decision — what an icon means, what the menu
 * offers, what a pin does to the order, what a bookmark points at — lives in a
 * controller and in the services behind it.
 */
import {
  FileView,
  ItemView,
  TFile,
  TFolder,
  type TAbstractFile,
  type WorkspaceLeaf
} from "obsidian";
import { t } from "../i18n";
import type { ExplorerController } from "../controllers/explorer-controller";
import type { PaneSectionsController } from "../controllers/pane-sections";
import { syncBadgeIcon, type SyncBadge } from "../services/explorer-badge";
import { sortSiblings, type ExplorerNode } from "../services/explorer-state";
import {
  bookmarkIcon,
  isBookmarkTreeEmpty,
  type Bookmark,
  type BookmarkFolder
} from "../services/bookmark-file";
import type { LatestCandidate } from "../services/latest-files";
import type { SchreibstubeSettings } from "../types";
import { applyIcon, installIconFont } from "./icon-font";
import { SCHREIBSTUBE_ICON } from "./schreibstube-icon";

export const EXPLORER_VIEW_TYPE = "schreibstube-explorer";

/** One icon for the pane's tab and for the ribbon entry that opens it, so the
 *  thing a person clicks and the thing that appears look like each other. The
 *  plugin registers it itself, so it cannot be absent the way a name borrowed
 *  from Obsidian's own set can. */
export const EXPLORER_RIBBON_ICON = SCHREIBSTUBE_ICON;

/** Long enough not to fire while scrolling, short enough to feel deliberate. */
const LONG_PRESS_MS = 500;

/** How many pinned rows sit in the shelf above the scroller. Beyond this the
 *  block continues in the scrolling list, so the shelf cannot eat the pane. */
const FIXED_PINNED_ROWS = 3;

/** Movement, in pixels, that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/**
 * What the pane remembers between sessions, per device.
 *
 * Obsidian's local storage is per vault and per device, which is the right home
 * for it: which folders a person has open on their phone is not a thing their
 * laptop should inherit, and it is not worth a sync conflict.
 */
const MEMORY_KEY = "schreibstube:explorer:view";

/** Separator inside a bookmark folder key. A vault name can hold a slash; it
 *  cannot hold this. */
const FOLDER_SEP = "\u001f";

/** Attachments drawn as a picture rather than a blank sheet. */
const MEDIA_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "mp4",
  "mov",
  "webm",
  "mkv",
  "mp3",
  "m4a",
  "ogg",
  "wav",
  "flac"
]);

type SectionId = "pinned" | "bookmarks" | "latest" | "files";

interface PaneMemory {
  /** Sections the person closed. Absent means open, which is the default. */
  collapsedSections?: string[];
  /** Bookmark folders the person closed. */
  collapsedBookmarks?: string[];
  /** Tree folders the person opened. */
  expandedFolders?: string[];
}

interface LocalStorageApi {
  loadLocalStorage?: (key: string) => unknown;
  saveLocalStorage?: (key: string, value: unknown) => void;
}

export interface ExplorerPaneHost {
  explorer: ExplorerController;
  sections: PaneSectionsController;
  settings: () => SchreibstubeSettings;
}

export class ExplorerPaneView extends ItemView {
  private host: ExplorerPaneHost | null = null;
  private expanded = new Set<string>();
  private collapsedSections = new Set<string>();
  private collapsedBookmarks = new Set<string>();
  private query = "";
  private body: HTMLElement | null = null;
  /** The fixed strip above the scroller: the filter and the pinned block. */
  private shelf: HTMLElement | null = null;
  /** Path of the row being dragged, or null when nothing is being dragged. */
  private dragging: string | null = null;
  /** Files open in some tab, recomputed once per draw rather than per row. */
  private openPaths = new Set<string>();
  private pending = false;
  /** A path to scroll to once the next draw has put it on screen. */
  private revealing: string | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.navigation = false;
    this.icon = SCHREIBSTUBE_ICON;
  }

  getViewType(): string {
    return EXPLORER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t().explorer.title;
  }

  getIcon(): string {
    return EXPLORER_RIBBON_ICON;
  }

  connect(host: ExplorerPaneHost): void {
    this.host = host;
    this.register(host.explorer.onChange(() => this.requestRender()));
    this.register(host.sections.onChange(() => this.requestRender()));
    this.requestRender();
  }

  protected async onOpen(): Promise<void> {
    installIconFont(this.containerEl.doc);
    this.readMemory();

    const root = this.contentEl;
    root.empty();
    root.addClass("schreibstube-explorer");

    const search = root.createEl("input", {
      type: "search",
      cls: "schreibstube-explorer-filter",
      attr: {
        placeholder: t().explorer.searchPlaceholder,
        "aria-label": t().explorer.searchPlaceholder
      }
    });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLowerCase();
      this.requestRender();
    });

    this.shelf = root.createDiv({ cls: "schreibstube-explorer-shelf" });
    this.body = root.createDiv({ cls: "schreibstube-explorer-body" });

    // The vault changes under the pane: a note created by a template, a file
    // deleted on another device and delivered by sync, frontmatter that binds a
    // note to a source. Each of those changes what a row should say.
    this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestRender()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRender()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.requestRender()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.requestRender()));

    this.render();
  }

  protected async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /**
   * Put a folder on screen, opened, with its ancestors opened above it.
   *
   * This is what a `vault://` bookmark does. The pane owns the tree, so it
   * reveals in itself rather than handing the job to Obsidian's explorer, which
   * may not even be open.
   */
  revealFolder(path: string): void {
    for (const ancestor of ancestorsOf(path)) this.expanded.add(ancestor);
    this.expanded.add(path);
    this.collapsedSections.delete("files");
    this.writeMemory();

    this.revealing = path;
    this.requestRender();
  }

  /** Collapse the redraws a burst of vault events would otherwise cause. */
  private requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    window.requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  private render(): void {
    const host = this.body;
    if (!host || !this.host) return;

    host.empty();
    this.shelf?.empty();
    this.openPaths = this.collectOpenPaths();
    const settings = this.host.settings();

    if (this.shelf) this.renderPinned(this.shelf, host);
    if (settings.explorerBookmarksEnabled) this.renderBookmarks(host);
    if (settings.explorerLatestEnabled) this.renderLatest(host);
    this.renderFiles(host);

    this.scrollToRevealed();
  }

  // --- sections -----------------------------------------------------------

  /**
   * A section: a header that toggles, and a body that is simply not drawn while
   * the section is closed. Keeping the rows out of the document rather than
   * hiding them is what keeps a vault of thousands of notes cheap to redraw.
   */
  private renderSection(host: HTMLElement, id: SectionId, icon: string): HTMLElement | null {
    const section = host.createDiv({ cls: "schreibstube-explorer-section" });
    const collapsed = this.collapsedSections.has(id);

    // "Files and folders" is drawn as a band across the pane, because it is the
    // one header that separates two kinds of thing: the three curated lists
    // above it and the vault itself below.
    const header = section.createEl("button", {
      cls: `schreibstube-explorer-section-header${id === "files" ? " is-divider" : ""}`,
      attr: { type: "button", "aria-expanded": String(!collapsed) }
    });
    applyIcon(
      header.createSpan({ cls: "schreibstube-explorer-twisty" }),
      collapsed ? "chevron-right" : "chevron-down"
    );
    applyIcon(header.createSpan({ cls: "schreibstube-explorer-glyph" }), icon);
    header.createSpan({
      cls: "schreibstube-explorer-section-title",
      text: t().explorer.sections[id]
    });

    header.addEventListener("click", () => {
      if (this.collapsedSections.has(id)) this.collapsedSections.delete(id);
      else this.collapsedSections.add(id);
      this.writeMemory();
      this.requestRender();
    });

    return collapsed ? null : section.createDiv({ cls: "schreibstube-explorer-section-body" });
  }

  /**
   * Everything pinned, wherever it lives.
   *
   * A pin also moves an item to the top of its own folder, but that is invisible
   * from anywhere else: a note pinned four folders down sits at the top of a
   * folder nobody has open. This section is where a pin is worth setting.
   *
   * It is drawn only when something is pinned, so a vault that does not use
   * pinning never pays a header for it.
   */
  /**
   * The pinned block, drawn in two places.
   *
   * The header and the first few rows go into the shelf above the scroller, so
   * what a person pinned is on screen whatever they have scrolled to — which is
   * the whole point of pinning something. Anything beyond that count is drawn at
   * the top of the scrolling list, directly beneath, so the block still reads as
   * one list and the shelf can never grow to eat the pane.
   */
  private renderPinned(shelf: HTMLElement, scroller: HTMLElement): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const items = controller.pinnedItems().filter((file) => this.matchesQuery(file.name));
    if (items.length === 0) return;

    const order = items.map((file) => file.path);
    const body = this.renderSection(shelf, "pinned", "pinned");
    if (!body) return;

    for (const [index, file] of items.entries()) {
      const host = index < FIXED_PINNED_ROWS ? body : scroller;
      this.renderPinnedRow(host, file, order);
    }
  }

  private renderPinnedRow(host: HTMLElement, file: TAbstractFile, order: string[]): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const isFolder = file instanceof TFolder;
    const row = host.createDiv({ cls: "schreibstube-explorer-row is-pinned-entry" });
    indent(row, 0);
    row.setAttribute("title", file.path);
    row.setAttribute("data-path", file.path);
    if (isFolder) row.addClass("is-folder");
    if (!isFolder) this.markOpenState(row, file.path);

    row.createSpan({ cls: "schreibstube-explorer-twisty" });
    applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), this.glyphFor(file));
    row.createSpan({ cls: "schreibstube-explorer-name", text: displayName(file) });
    if (file instanceof TFile) this.renderBadge(row, file);

    this.renderRowActions(row, file);
    this.wirePinnedDrag(row, file.path, order);

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      controller.showMenu(file, event);
    });

    // A pinned folder shows where it is rather than opening a second copy of
    // the tree inside the section.
    row.addEventListener("click", () => {
      if (this.dragging) return;
      if (isFolder) this.revealFolder(file.path);
      else void controller.open(file, false);
    });
  }

  private renderBookmarks(host: HTMLElement): void {
    const sections = this.host?.sections;
    const body = this.renderSection(host, "bookmarks", "bookmark");
    if (!body || !sections) return;

    const tree = sections.bookmarks();

    if (isBookmarkTreeEmpty(tree)) {
      const path = sections.bookmarksPath();
      body.createEl("p", {
        cls: "schreibstube-explorer-empty",
        text: sections.bookmarksFileMissing()
          ? t().explorer.bookmarks.missingFile(path)
          : t().explorer.bookmarks.empty
      });
      body.createEl("p", {
        cls: "schreibstube-explorer-empty",
        text: t().explorer.bookmarks.hint(path)
      });
      return;
    }

    // A filter that matches nothing leaves the section empty on purpose: the
    // filter box is right above it and says why.
    for (const bookmark of tree.loose) this.renderBookmarkRow(body, bookmark, 0);
    for (const folder of tree.folders) this.renderBookmarkFolder(body, folder, "", 0);
  }

  /** Returns how many bookmark rows were drawn, so a filter that matches
   *  nothing can say so rather than showing empty folders. */
  private renderBookmarkFolder(
    host: HTMLElement,
    folder: BookmarkFolder,
    parentKey: string,
    depth: number
  ): number {
    const key = parentKey.length > 0 ? `${parentKey}${FOLDER_SEP}${folder.name}` : folder.name;
    const matching = this.bookmarkMatches(folder);
    if (matching === 0) return 0;

    // A filter opens every folder that still has something in it, and closes
    // nothing the person had opened by hand.
    const collapsed = this.query.length === 0 && this.collapsedBookmarks.has(key);

    const row = host.createDiv({ cls: "schreibstube-explorer-row is-folder" });
    indent(row, depth);

    applyIcon(
      row.createSpan({ cls: "schreibstube-explorer-twisty" }),
      collapsed ? "chevron-right" : "chevron-down"
    );
    applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), "folder");
    row.createSpan({ cls: "schreibstube-explorer-name", text: folder.name });

    row.addEventListener("click", () => {
      if (this.collapsedBookmarks.has(key)) this.collapsedBookmarks.delete(key);
      else this.collapsedBookmarks.add(key);
      this.writeMemory();
      this.requestRender();
    });

    if (collapsed) return 1;

    let drawn = 1;
    for (const bookmark of folder.bookmarks) {
      drawn += this.renderBookmarkRow(host, bookmark, depth + 1);
    }
    for (const sub of folder.subfolders) {
      drawn += this.renderBookmarkFolder(host, sub, key, depth + 1);
    }
    return drawn;
  }

  private renderBookmarkRow(host: HTMLElement, bookmark: Bookmark, depth: number): number {
    if (!this.matchesQuery(bookmark.name)) return 0;

    const row = host.createDiv({ cls: "schreibstube-explorer-row is-bookmark" });
    indent(row, depth);
    row.setAttribute("data-kind", bookmark.kind);
    row.setAttribute("title", bookmark.url);

    row.createSpan({ cls: "schreibstube-explorer-twisty" });
    applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), bookmarkIcon(bookmark.kind));
    row.createSpan({ cls: "schreibstube-explorer-name", text: bookmark.name });

    row.addEventListener("click", () => this.host?.sections.openBookmark(bookmark));
    return 1;
  }

  /** How many bookmarks under a folder survive the filter. */
  private bookmarkMatches(folder: BookmarkFolder): number {
    const here = folder.bookmarks.filter((bookmark) => this.matchesQuery(bookmark.name)).length;
    return folder.subfolders.reduce((total, sub) => total + this.bookmarkMatches(sub), here);
  }

  private renderLatest(host: HTMLElement): void {
    const sections = this.host?.sections;
    const body = this.renderSection(host, "latest", "clock");
    if (!body || !sections) return;

    const { created, modified } = sections.latestFiles();
    const labels = t().explorer.latest;

    const drawn =
      this.renderLatestGroup(body, labels.created, created) +
      this.renderLatestGroup(body, labels.modified, modified);

    if (drawn === 0) {
      body.createEl("p", { cls: "schreibstube-explorer-empty", text: labels.empty });
    }
  }

  private renderLatestGroup(
    host: HTMLElement,
    label: string,
    files: readonly LatestCandidate[]
  ): number {
    const matching = files.filter((file) => this.matchesQuery(file.name));
    if (matching.length === 0) return 0;

    host.createDiv({ cls: "schreibstube-explorer-subheading", text: label });

    for (const file of matching) {
      const row = host.createDiv({ cls: "schreibstube-explorer-row is-latest" });
      indent(row, 0);
      row.setAttribute("title", file.path);
      this.markOpenState(row, file.path);

      row.createSpan({ cls: "schreibstube-explorer-twisty" });
      applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), "file-text");
      row.createSpan({ cls: "schreibstube-explorer-name", text: file.name });

      row.addEventListener("click", () => void this.host?.sections.openLatest(file.path));
    }

    return matching.length;
  }

  private renderFiles(host: HTMLElement): void {
    const body = this.renderSection(host, "files", "folder");
    if (!body) return;

    const tree = body.createDiv({ cls: "schreibstube-explorer-tree" });
    const drawn = this.renderChildren(tree, this.app.vault.getRoot(), 0);

    if (drawn === 0) {
      tree.createEl("p", { cls: "schreibstube-explorer-empty", text: t().explorer.empty });
    }
  }

  // --- the file tree ------------------------------------------------------

  /** Returns how many rows were drawn, so an empty vault can say so. */
  private renderChildren(host: HTMLElement, folder: TFolder, depth: number): number {
    const controller = this.host?.explorer;
    if (!controller) return 0;

    const nodes: ExplorerNode[] = folder.children.map((child) => ({
      path: child.path,
      name: child.name,
      kind: child instanceof TFolder ? "folder" : "file"
    }));

    const byPath = new Map(folder.children.map((child) => [child.path, child]));
    let drawn = 0;

    for (const node of sortSiblings(nodes, controller.data())) {
      const child = byPath.get(node.path);
      if (!child) continue;

      if (child instanceof TFolder) {
        // While filtering, a folder is worth a row only if something inside it
        // matches; the alternative is a tree of empty branches.
        const matches = this.query.length === 0 || this.folderMatches(child);
        if (!matches) continue;

        this.renderRow(host, child, depth);
        drawn += 1;
        if (this.isExpanded(child)) drawn += this.renderChildren(host, child, depth + 1);
        continue;
      }

      if (!this.matchesQuery(child.name)) continue;
      this.renderRow(host, child, depth);
      drawn += 1;
    }

    return drawn;
  }

  private folderMatches(folder: TFolder): boolean {
    return folder.children.some((child) =>
      child instanceof TFolder ? this.folderMatches(child) : this.matchesQuery(child.name)
    );
  }

  private matchesQuery(name: string): boolean {
    return this.query.length === 0 || name.toLowerCase().includes(this.query);
  }

  /** A filter expands the tree for as long as it is set, without disturbing
   *  what the person had opened by hand. */
  private isExpanded(folder: TFolder): boolean {
    return this.query.length > 0 || this.expanded.has(folder.path);
  }

  private renderRow(host: HTMLElement, file: TAbstractFile, depth: number): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const isFolder = file instanceof TFolder;
    const row = host.createDiv({ cls: "schreibstube-explorer-row" });
    indent(row, depth);
    row.setAttribute("data-path", file.path);
    row.setAttribute("role", "treeitem");
    if (isFolder) row.addClass("is-folder");
    if (controller.isPinned(file.path)) row.addClass("is-pinned");
    if (file instanceof TFile) this.markOpenState(row, file.path);

    const twisty = row.createSpan({ cls: "schreibstube-explorer-twisty" });
    if (isFolder) {
      applyIcon(twisty, this.isExpanded(file) ? "chevron-down" : "chevron-right");
    }

    applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), this.glyphFor(file));
    row.createSpan({ cls: "schreibstube-explorer-name", text: displayName(file) });

    if (controller.isPinned(file.path)) {
      applyIcon(row.createSpan({ cls: "schreibstube-explorer-pin" }), "pinned");
    }

    if (file instanceof TFile) this.renderBadge(row, file);

    this.renderRowActions(row, file);

    this.wireRow(row, file, isFolder);
  }

  /** The menu button a row shows on hover. Every action lives behind it. */
  private renderRowActions(row: HTMLElement, file: TAbstractFile): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const more = row.createEl("button", {
      cls: "schreibstube-explorer-more",
      attr: { type: "button", "aria-label": t().explorer.menu.more }
    });
    applyIcon(more, "dots");
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      controller.showMenu(file, event);
    });
  }

  /**
   * Dragging a pinned row to reorder the block.
   *
   * A mouse begins the drag as soon as the pointer leaves the row it pressed;
   * a finger has to hold first, because on a touch surface a short drag down a
   * list is how a person scrolls, and taking that gesture would make the pane
   * impossible to move. Pinned rows carry no long-press menu of their own, so
   * holding is free here in a way it would not be in the tree.
   *
   * Nothing is written until the finger or button comes up, and a drag that
   * ends where it started writes nothing at all.
   */
  private wirePinnedDrag(row: HTMLElement, path: string, order: string[]): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    let startX = 0;
    let startY = 0;
    let armed = false;
    let holdTimer: number | null = null;

    const clearHold = (): void => {
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      holdTimer = null;
    };

    const finish = (): void => {
      clearHold();
      armed = false;
      row.removeClass("is-dragging");
      this.clearDropMarks();
      // The click that follows a pointerup would otherwise open the file the
      // drag just moved.
      window.setTimeout(() => {
        this.dragging = null;
      }, 0);
    };

    row.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;

      if (event.pointerType === "touch") {
        holdTimer = window.setTimeout(() => {
          armed = true;
          row.addClass("is-dragging");
        }, LONG_PRESS_MS);
      } else {
        armed = true;
      }
    });

    row.addEventListener("pointermove", (event: PointerEvent) => {
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);

      // A finger that moves before the hold has elapsed is scrolling the pane.
      if (!armed) {
        if (moved > DRAG_THRESHOLD_PX) clearHold();
        return;
      }
      if (this.dragging === null && moved <= DRAG_THRESHOLD_PX) return;

      if (this.dragging === null) {
        this.dragging = path;
        row.addClass("is-dragging");
        row.setPointerCapture(event.pointerId);
      }

      this.markDropTarget(event.clientY);
    });

    row.addEventListener("pointerup", (event: PointerEvent) => {
      if (this.dragging !== path) {
        finish();
        return;
      }

      const next = this.orderAfterDrop(path, order, event.clientY);
      finish();
      if (next) controller.reorderPinned(next);
    });

    row.addEventListener("pointercancel", finish);
  }

  /**
   * Every file open in a tab, the active one included.
   *
   * A view that shows a file extends `FileView`, whatever the file is, so this
   * counts notes, images, PDFs and canvases alike rather than markdown only. A
   * file open in a sidebar counts too: it is on screen, which is what the mark
   * is about.
   */
  private collectOpenPaths(): Set<string> {
    const paths = new Set<string>();

    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof FileView && view.file) paths.add(view.file.path);
    });

    return paths;
  }

  /**
   * Mark a row for the file it stands for: the one in front of the person, or
   * one waiting in another tab. Never both — the active file is open too, and
   * a second bar would say nothing the stronger one does not already say.
   */
  private markOpenState(row: HTMLElement, path: string): void {
    if (this.app.workspace.getActiveFile()?.path === path) {
      row.addClass("is-active");
      return;
    }
    if (this.openPaths.has(path)) row.addClass("is-open");
  }

  /**
   * Every row of the Pinned section on screen, shelf and scroller alike, in
   * drawn order. Deliberately not `.is-pinned`, which the tree also puts on a
   * pinned row: dropping onto one of those would reorder against a row that is
   * not part of this list.
   */
  private pinnedRows(): HTMLElement[] {
    const root = this.contentEl;
    return Array.from(
      root.querySelectorAll<HTMLElement>(".schreibstube-explorer-row.is-pinned-entry")
    );
  }

  /** Which row the pointer is over, and whether it is above that row's middle. */
  private dropAt(clientY: number): { path: string; before: boolean } | null {
    for (const row of this.pinnedRows()) {
      const box = row.getBoundingClientRect();
      if (clientY < box.top || clientY > box.bottom) continue;

      const path = row.getAttribute("data-path");
      if (!path) continue;
      return { path, before: clientY < box.top + box.height / 2 };
    }
    return null;
  }

  private markDropTarget(clientY: number): void {
    this.clearDropMarks();
    const target = this.dropAt(clientY);
    if (!target || target.path === this.dragging) return;

    for (const row of this.pinnedRows()) {
      if (row.getAttribute("data-path") !== target.path) continue;
      row.addClass(target.before ? "is-drop-before" : "is-drop-after");
    }
  }

  private clearDropMarks(): void {
    for (const row of this.pinnedRows()) {
      row.removeClass("is-drop-before");
      row.removeClass("is-drop-after");
    }
  }

  /** The order the block should take, or null when the drag changed nothing. */
  private orderAfterDrop(path: string, order: string[], clientY: number): string[] | null {
    const target = this.dropAt(clientY);
    if (!target || target.path === path) return null;

    const without = order.filter((entry) => entry !== path);
    const at = without.indexOf(target.path);
    if (at === -1) return null;

    const next = [...without];
    next.splice(target.before ? at : at + 1, 0, path);

    return next.join("\u0000") === order.join("\u0000") ? null : next;
  }

  private renderBadge(row: HTMLElement, file: TFile): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const badge = controller.badgeFor(file);
    if (badge === "none") return;

    const label = badgeLabel(badge, controller.pendingChangesFor(file));
    const el = row.createSpan({ cls: "schreibstube-explorer-badge" });
    el.setAttribute("data-sync", badge);
    el.setAttribute("aria-label", label);
    el.setAttribute("title", `${label}\n${controller.lastCheckedFor(file)}`);
    applyIcon(el, syncBadgeIcon(badge));
  }

  private wireRow(row: HTMLElement, file: TAbstractFile, isFolder: boolean): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    row.addEventListener("click", () => {
      if (isFolder) {
        this.toggle(file.path);
        return;
      }
      void controller.open(file, false);
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      controller.showMenu(file, event);
    });

    // Mobile has no right click and Obsidian's own long-press belongs to its
    // explorer, so the pane brings its own. The button on the row stays as the
    // way that always works.
    let timer: number | null = null;
    const cancel = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    row.addEventListener(
      "touchstart",
      (event) => {
        const touch = event.touches[0];
        cancel();
        timer = window.setTimeout(() => {
          timer = null;
          controller.showMenu(file, { x: touch.clientX, y: touch.clientY });
        }, LONG_PRESS_MS);
      },
      { passive: true }
    );

    for (const event of ["touchend", "touchmove", "touchcancel"] as const) {
      row.addEventListener(event, cancel, { passive: true });
    }
  }

  private toggle(path: string): void {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
    this.writeMemory();
    this.requestRender();
  }

  private glyphFor(file: TAbstractFile): string {
    const chosen = this.host?.explorer.iconFor(file.path);
    if (chosen) return chosen;

    if (file instanceof TFolder) return this.isExpanded(file) ? "folder-open" : "folder";
    if (!(file instanceof TFile)) return "file";

    const extension = file.extension.toLowerCase();
    if (extension === "md") return "file-text";
    // A vault's attachments are mostly pictures and recordings, and a row of
    // identical blank sheets says nothing about which is which.
    if (MEDIA_EXTENSIONS.has(extension)) return "photo";
    return "file";
  }

  private scrollToRevealed(): void {
    const path = this.revealing;
    if (path === null || !this.body) return;
    this.revealing = null;

    const row = this.body.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (!(row instanceof HTMLElement)) return;

    row.scrollIntoView({ block: "center" });
    // A folder that was already on screen would otherwise jump to nowhere
    // visible; the mark says which row the bookmark meant.
    row.addClass("is-revealed");
    window.setTimeout(() => row.removeClass("is-revealed"), 1200);
  }

  // --- what the pane remembers --------------------------------------------

  private readMemory(): void {
    const storage = this.app as unknown as LocalStorageApi;
    if (typeof storage.loadLocalStorage !== "function") return;

    let memory: PaneMemory;
    try {
      const raw = storage.loadLocalStorage(MEMORY_KEY);
      if (!raw || typeof raw !== "object") return;
      memory = raw as PaneMemory;
    } catch {
      // A hardened setup can refuse storage entirely; the pane opens with
      // everything expanded rather than failing to open.
      return;
    }

    this.collapsedSections = toSet(memory.collapsedSections);
    this.collapsedBookmarks = toSet(memory.collapsedBookmarks);
    this.expanded = toSet(memory.expandedFolders);
  }

  private writeMemory(): void {
    const storage = this.app as unknown as LocalStorageApi;
    if (typeof storage.saveLocalStorage !== "function") return;

    try {
      storage.saveLocalStorage(MEMORY_KEY, {
        collapsedSections: [...this.collapsedSections],
        collapsedBookmarks: [...this.collapsedBookmarks],
        expandedFolders: [...this.expanded]
      } satisfies PaneMemory);
    } catch {
      // Nothing here is worth failing a click over.
    }
  }
}

/**
 * Put a row at its depth.
 *
 * Depth is handed to CSS rather than resolved to pixels here, so the base
 * padding and the step per level are stated once in the stylesheet and every
 * section — pinned, bookmarks, latest, the tree — sits on the same grid. A row
 * at depth 0 in one section lines up with a row at depth 0 in another, which is
 * what makes the icon column read as a column.
 */
function indent(row: HTMLElement, depth: number): void {
  row.style.setProperty("--schreibstube-depth", String(depth));
}

function toSet(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
  );
}

/** Every folder above a path, outermost first. */
function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  parts.pop();

  const ancestors: string[] = [];
  let current = "";
  for (const part of parts) {
    current = current.length > 0 ? `${current}/${part}` : part;
    ancestors.push(current);
  }
  return ancestors;
}

function displayName(file: TAbstractFile): string {
  return file instanceof TFile && file.extension === "md" ? file.basename : file.name;
}

function badgeLabel(badge: SyncBadge, pending: number): string {
  const labels = t().explorer.badge;
  switch (badge) {
    case "synced":
      return labels.synced;
    case "pending":
      return labels.pending(pending);
    case "unchecked":
      return labels.unchecked;
    case "error":
      return labels.error;
    default:
      return "";
  }
}
