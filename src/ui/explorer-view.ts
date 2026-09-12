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
 * It draws and reports. Every decision — what an icon means, what the menu
 * offers, what a pin does to the order — lives in the controller and in the
 * services behind it.
 */
import { ItemView, TFile, TFolder, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { ExplorerController } from "../controllers/explorer-controller";
import { syncBadgeIcon, type SyncBadge } from "../services/explorer-badge";
import { sortSiblings, type ExplorerNode } from "../services/explorer-state";
import { applyIcon, installIconFont } from "./icon-font";

export const EXPLORER_VIEW_TYPE = "schreibstube-explorer";

/** Long enough not to fire while scrolling, short enough to feel deliberate. */
const LONG_PRESS_MS = 500;

export class ExplorerPaneView extends ItemView {
  private controller: ExplorerController | null = null;
  private expanded = new Set<string>();
  private query = "";
  private tree: HTMLElement | null = null;
  private pending = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.navigation = false;
    this.icon = "folder-tree";
  }

  getViewType(): string {
    return EXPLORER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t().explorer.title;
  }

  setController(controller: ExplorerController): void {
    this.controller = controller;
    this.register(controller.onChange(() => this.requestRender()));
    this.requestRender();
  }

  protected async onOpen(): Promise<void> {
    installIconFont(this.containerEl.doc);

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

    this.tree = root.createDiv({ cls: "schreibstube-explorer-tree" });

    // The vault changes under the pane: a note created by a template, a file
    // deleted on another device and delivered by sync, frontmatter that binds a
    // note to a source. Each of those changes what a row should say.
    this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestRender()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRender()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.requestRender()));

    this.render();
  }

  protected async onClose(): Promise<void> {
    this.contentEl.empty();
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
    const host = this.tree;
    if (!host || !this.controller) return;

    host.empty();
    const root = this.app.vault.getRoot();
    const drawn = this.renderChildren(host, root, 0);

    if (drawn === 0) {
      host.createEl("p", { cls: "schreibstube-explorer-empty", text: t().explorer.empty });
    }
  }

  /** Returns how many rows were drawn, so an empty vault can say so. */
  private renderChildren(host: HTMLElement, folder: TFolder, depth: number): number {
    const controller = this.controller;
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

      if (this.query.length > 0 && !child.name.toLowerCase().includes(this.query)) continue;
      this.renderRow(host, child, depth);
      drawn += 1;
    }

    return drawn;
  }

  private folderMatches(folder: TFolder): boolean {
    return folder.children.some((child) =>
      child instanceof TFolder
        ? this.folderMatches(child)
        : child.name.toLowerCase().includes(this.query)
    );
  }

  /** A filter expands the tree for as long as it is set, without disturbing
   *  what the person had opened by hand. */
  private isExpanded(folder: TFolder): boolean {
    return this.query.length > 0 || this.expanded.has(folder.path);
  }

  private renderRow(host: HTMLElement, file: TAbstractFile, depth: number): void {
    const controller = this.controller;
    if (!controller) return;

    const isFolder = file instanceof TFolder;
    const row = host.createDiv({ cls: "schreibstube-explorer-row" });
    row.style.paddingLeft = `${depth * 17 + 4}px`;
    row.setAttribute("data-path", file.path);
    row.setAttribute("role", "treeitem");
    if (isFolder) row.addClass("is-folder");
    if (controller.isPinned(file.path)) row.addClass("is-pinned");
    if (file instanceof TFile && this.app.workspace.getActiveFile()?.path === file.path) {
      row.addClass("is-active");
    }

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

    const more = row.createEl("button", {
      cls: "schreibstube-explorer-more",
      attr: { type: "button", "aria-label": t().explorer.menu.more }
    });
    applyIcon(more, "dots");
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      controller.showMenu(file, event);
    });

    this.wireRow(row, file, isFolder);
  }

  private renderBadge(row: HTMLElement, file: TFile): void {
    const controller = this.controller;
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
    const controller = this.controller;
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
    this.requestRender();
  }

  private glyphFor(file: TAbstractFile): string {
    const chosen = this.controller?.iconFor(file.path);
    if (chosen) return chosen;

    if (file instanceof TFolder) return this.isExpanded(file) ? "folder-open" : "folder";
    return file instanceof TFile && file.extension === "md" ? "file-text" : "file";
  }
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
