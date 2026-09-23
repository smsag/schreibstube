/**
 * A folder's pictures as a grid of tiles, in a tab of the main area.
 *
 * A folder of scans or photos is a list of names in the tree, and the name
 * of a picture says almost nothing; a wall of them says everything at once.
 * Opened from a folder's menu, and from then on it follows: press another
 * folder in the pane and the grid shows that one. Closing the tab is how the
 * following stops — a grid that had to be re-asked for every folder would
 * be asked once.
 *
 * It draws and reports. Which files are pictures and in what order is
 * decided in `folder-images`, handed over by the explorer controller, which
 * also knows which pictures the pane has already taken away.
 *
 * A tile opens its picture in a new tab, never in this one: a plain open
 * into the active leaf would replace the grid the person is looking at.
 */
import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { FolderImages } from "../services/folder-images";
import { refreshLeafHeader } from "../services/workspace-internals";
import { wirePress } from "./explorer-gestures";
import { applyIcon, installIconFont } from "./icon-font";

export const FOLDER_TILES_VIEW_TYPE = "schreibstube-folder-tiles";

export interface FolderTilesHost {
  /** The folder's pictures, or null when the folder is no longer in the vault. */
  tiles(folder: string): FolderImages | null;
  /** The URL an <img> can load the picture from, or null when the vault cannot serve it. */
  resourceUrl(path: string): string | null;
  /** Always into a new tab. */
  open(path: string): Promise<void>;
  showMenu(path: string, at: MouseEvent | { x: number; y: number }): void;
  /** The folder a person pressed in the pane; returns the unsubscribe. */
  onFolderChosen(listener: (folder: string) => void): () => void;
}

export class FolderTilesView extends ItemView {
  private host: FolderTilesHost | null = null;
  private folder: string | null = null;
  private pending = false;
  /**
   * Whether the grid keeps up with the folder pressed in the pane.
   *
   * On when opened from a folder's menu, which is the only way it opens
   * today; kept as state so a future "stay on this folder" has somewhere to
   * put its answer, and so a restart brings the tab back the way it was.
   */
  private following = true;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    // A tab in the main area, unlike the sidebar panels: it belongs in the
    // tab history like a document, so Back returns to it.
    this.navigation = true;
  }

  getViewType(): string {
    return FOLDER_TILES_VIEW_TYPE;
  }

  getDisplayText(): string {
    const labels = t().explorer.tiles;
    if (this.folder === null) return labels.viewTitle;
    return labels.viewTitleFor(isRoot(this.folder) ? labels.root : basenameOf(this.folder));
  }

  override getIcon(): string {
    return "image";
  }

  connect(host: FolderTilesHost): void {
    this.host = host;
    // Only the view's own state moves. No leaf is revealed and nothing is
    // focused: a person browsing the tree keeps the tree.
    this.register(
      host.onFolderChosen((folder) => {
        if (!this.following) return;
        this.folder = folder;
        this.folderChanged();
      })
    );
    this.requestRender();
  }

  /** Which folder, kept in the view's state so a restored workspace comes
   *  back on it rather than on an empty tab. */
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const raw = (state as { folder?: unknown; following?: unknown } | null) ?? {};
    if (typeof raw.folder === "string") this.folder = raw.folder;
    if (typeof raw.following === "boolean") this.following = raw.following;
    await super.setState(state, result);
    this.requestRender();
  }

  override getState(): Record<string, unknown> {
    return {
      ...super.getState(),
      following: this.following,
      ...(this.folder === null ? {} : { folder: this.folder })
    };
  }

  protected override async onOpen(): Promise<void> {
    installIconFont(this.containerEl.doc);
    this.contentEl.addClass("schreibstube-folder-tiles");

    // A picture added, deleted or moved changes a tile or whether there is one.
    this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        // The folder itself, or one above it, moved: the grid goes with it.
        if (
          this.folder !== null &&
          (this.folder === oldPath || this.folder.startsWith(`${oldPath}/`))
        ) {
          this.folder = file.path + this.folder.slice(oldPath.length);
        }
        this.requestRender();
      })
    );

    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /**
   * The grid moved to another folder on its own, without a `setViewState`.
   *
   * Obsidian learns about state it set; state the view changed itself has
   * to be announced, or a restart brings back the folder the tab was opened
   * on rather than the one it was last showing, and the tab keeps its old
   * name until something else redraws the header.
   */
  private folderChanged(): void {
    this.app.workspace.requestSaveLayout();
    refreshLeafHeader(this.leaf);
    this.requestRender();
  }

  /** One redraw per frame, however many vault events arrived in it. */
  private requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    window.requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    const labels = t().explorer.tiles;

    if (this.folder === null || this.host === null) {
      root.createDiv({ cls: "schreibstube-tiles-empty", text: labels.noFolder });
      return;
    }

    const tiles = this.host.tiles(this.folder);
    const header = root.createDiv({ cls: "schreibstube-tiles-header" });
    const title = header.createDiv({ cls: "schreibstube-tiles-title" });
    applyIcon(title.createSpan({ cls: "schreibstube-explorer-glyph" }), "folder");
    title.createSpan({ text: isRoot(this.folder) ? labels.root : this.folder });

    if (tiles === null) {
      root.createDiv({ cls: "schreibstube-tiles-empty", text: labels.gone });
      return;
    }

    const total = tiles.images.length + tiles.held;
    header.createDiv({ cls: "schreibstube-tiles-summary", text: labels.summary(total) });
    if (this.following) {
      header.createDiv({ cls: "schreibstube-tiles-following", text: labels.following });
    }

    if (tiles.images.length === 0) {
      // Not a failure: a folder of notes has no pictures of its own, and
      // saying so is more use than an empty wall.
      root.createDiv({ cls: "schreibstube-tiles-empty", text: labels.empty });
      return;
    }

    const grid = root.createDiv({ cls: "schreibstube-tiles-grid" });
    for (const image of tiles.images) this.renderTile(grid, image.path, image.name);

    if (tiles.held > 0) {
      root.createEl("p", { cls: "schreibstube-tiles-more", text: labels.more(tiles.held) });
    }
  }

  private renderTile(grid: HTMLElement, path: string, name: string): void {
    const host = this.host;
    if (!host) return;

    const tile = grid.createDiv({
      cls: "schreibstube-tiles-tile",
      attr: { role: "button", tabindex: "0", title: name, "aria-label": name }
    });

    const url = host.resourceUrl(path);
    if (url === null) {
      tile.addClass("schreibstube-tiles-tile-missing");
      tile.createSpan({ text: name });
    } else {
      // Lazy, because a folder can hold hundreds and the tile's own box is
      // already sized by the stylesheet; the browser fetches what scrolls in.
      const img = tile.createEl("img", { attr: { src: url, alt: name } });
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
    }

    // The same press a row in the pane answers: a click opens, a right click
    // or a held finger asks for the menu, and the lift that ends a long press
    // does not also open the picture.
    wirePress(tile, {
      isDragging: () => false,
      activate: () => void host.open(path),
      showMenu: (at) => host.showMenu(path, at)
    });
    tile.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void host.open(path);
    });
  }
}

/** The vault calls its root "/", and an empty path is the same place. */
function isRoot(path: string): boolean {
  return path === "/" || path.length === 0;
}

function basenameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
