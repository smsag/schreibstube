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
 * controller and in the services behind it. The gestures a row answers to, the
 * places a drag may land, a section's header and what the pane remembers each
 * live in a module beside this one.
 */
import {
  FileView,
  getAllTags,
  ItemView,
  Notice,
  TFile,
  TFolder,
  type TAbstractFile,
  type WorkspaceLeaf
} from "obsidian";
import { t } from "../i18n";
import type { ExplorerController } from "../controllers/explorer-controller";
import type { PaneSectionsController } from "../controllers/pane-sections";
import { syncBadgeIcon, type SyncBadge } from "../services/explorer-badge";
import { frontmatterTitle } from "../services/note-title";
import {
  matchesText,
  rankFiles,
  searchFields,
  type SearchCandidate,
  type SearchFields
} from "../services/file-search";
import { sortSiblings, type ExplorerNode } from "../services/explorer-state";
import {
  bookmarkIcon,
  isBookmarkTreeEmpty,
  type Bookmark,
  type BookmarkFolder
} from "../services/bookmark-file";
import { fileGlyph, fileNameParts } from "../services/file-glyph";
import { groundColour } from "../services/ground-colour";
import { tallyTasks, taskCountLabel, type TaskTally } from "../services/task-count";
import type { LatestCandidate } from "../services/latest-files";
import {
  ancestorsOf,
  isMovePlan,
  moveRefusalMessage,
  planMove,
  type MoveContext
} from "../services/tree-move";
import type { SchreibstubeSettings } from "../types";
import { countFilesUnder, folderCountLabel } from "../services/folder-count";
import { folderPathsUnder, treeAction } from "../services/vault-tree";
import {
  clearDropMarks,
  clearMoveMarks,
  dropAt,
  markDropTarget,
  markMoveTarget,
  moveTargetAt,
  orderAfterDrop
} from "./explorer-drop";
import { DragGesture, wirePress } from "./explorer-gestures";
import { readPaneMemory, stateFromMemory, writePaneMemory } from "./explorer-memory";
import {
  renderSection as renderSectionHeader,
  type SectionAction,
  type SectionAlert,
  type SectionId,
  type SectionOptions
} from "./explorer-section";
import { applyIcon, installIconFont } from "./icon-font";
import { SCHREIBSTUBE_ICON } from "./schreibstube-icon";

export const EXPLORER_VIEW_TYPE = "schreibstube-explorer";

/** One icon for the pane's tab and for the ribbon entry that opens it, so the
 *  thing a person clicks and the thing that appears look like each other. The
 *  plugin registers it itself, so it cannot be absent the way a name borrowed
 *  from Obsidian's own set can. */
export const EXPLORER_RIBBON_ICON = SCHREIBSTUBE_ICON;

/**
 * How long the filter waits after the last keystroke before redrawing.
 *
 * A redraw builds every matching row and everything on it, so doing one per
 * character is what a person feels as the pane fighting the keyboard. Short
 * enough to feel immediate on the pause between words.
 */
const FILTER_DEBOUNCE_MS = 150;

/**
 * How many rows a filter draws before it stops and says how many more matched.
 *
 * A filter of one letter matches most of a vault, and a phone cannot build
 * thousands of rows between keystrokes. Nobody reads past the first screenful
 * anyway: past this the answer is a narrower filter, not a longer list.
 */
const FILTER_ROW_CAP = 200;

/**
 * How many pinned rows the shelf holds while the block is closed.
 *
 * They cost nothing to leave there: the strip is on screen at every scroll
 * position anyway, so closing the block takes away the rows below these rather
 * than all of them.
 */
const FIXED_PINNED_ROWS = 3;

/**
 * The most of the pane an open pinned strip may take.
 *
 * Sticky rows are only worth having while there is something for them to stay
 * in front of: a strip that fills the pane is a pane with no vault in it. Half
 * leaves as much shortlist as vault, and being a share rather than a count it
 * answers a phone, a tall sidebar and a keyboard covering the screen by itself.
 */
const SHELF_SHARE_OF_PANE = 0.5;

/** Used only until the pane has been laid out and can be measured. */
const FALLBACK_ROW_HEIGHT_PX = 27;

/** How close to the top a held header lands, allowing for sub-pixel layout. */
const STUCK_TOLERANCE_PX = 1.5;

/** Separator inside a bookmark folder key. A vault name can hold a slash; it
 *  cannot hold this. */
const FOLDER_SEP = "\u001f";

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
  /** The one drag the pane allows at a time, and the redraw it holds back. */
  private drag = new DragGesture(
    () => this.body,
    () => this.requestRender()
  );
  /** Files open in some tab, recomputed once per draw rather than per row. */
  private openPaths = new Set<string>();
  /**
   * Folders opened to put a revealed row on screen, and whether the tree was
   * opened for the same reason.
   *
   * Kept apart from what the person opened by hand, and never written to
   * storage: being shown where a file lives should not quietly rearrange the
   * pane for every session to come.
   */
  private revealedFolders = new Set<string>();
  private revealedTree = false;
  private pending = false;
  /** Waiting for the typing to stop before the filter redraws. */
  private filterTimer: number | null = null;
  /** Every file the filter kept, however many that is. Null when no filter is
   *  set, which is the difference between "everything" and "nothing". */
  private matches: Set<string> | null = null;
  /**
   * The best of those, with every folder on the way to one, which is what the
   * tree draws.
   *
   * Two sets and not one because the cap belongs to the tree alone: a pinned
   * row or a note in Latest that matched must stay on screen whether or not it
   * was among the two hundred the tree had room for.
   */
  private treeMatches: Set<string> | null = null;
  /**
   * Each file's tokenized fields, kept between keystrokes.
   *
   * Tokenizing is the expensive half of a filter and a file's name, title and
   * tags do not change while somebody is typing; the entry is dropped when the
   * vault says that file changed. Keyed by path, so a vault of ten thousand
   * files costs one pass on the first keystroke and none on the rest.
   */
  private fields = new Map<string, SearchFields>();
  /** How many files the filter matched, and how many rows have been drawn for
   *  them, so a capped list can say what it is holding back. */
  private matchCount = 0;
  private drawnMatches = 0;
  /** Files under each folder, counted once per draw. */
  private folderCounts = new Map<string, number>();
  /** A path to scroll to once the next draw has put it on screen. */
  private revealing: string | null = null;
  /** Whether that reveal followed a note being opened rather than a request:
   *  it then scrolls only if the row is out of view, and does not flash. */
  private revealingQuietly = false;
  /** A pending ground measurement, so several signals in one frame cost one read. */
  private groundFrame: number | null = null;

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

  override getIcon(): string {
    return EXPLORER_RIBBON_ICON;
  }

  connect(host: ExplorerPaneHost): void {
    this.host = host;
    this.register(host.explorer.onChange(() => this.requestRender()));
    this.register(host.sections.onChange(() => this.requestRender()));
    this.requestRender();
  }

  protected override async onOpen(): Promise<void> {
    installIconFont(this.containerEl.doc);
    this.readMemory();

    const root = this.contentEl;
    root.empty();
    root.addClass("schreibstube-explorer");

    // The field and its clear button share a box, so the button can sit inside
    // the field rather than beside it.
    const filter = root.createDiv({ cls: "schreibstube-explorer-filter-row" });
    const search = filter.createEl("input", {
      type: "search",
      cls: "schreibstube-explorer-filter",
      attr: {
        placeholder: t().explorer.searchPlaceholder,
        "aria-label": t().explorer.searchPlaceholder
      }
    });
    search.addEventListener("input", () => {
      const value = search.value.trim().toLowerCase();
      this.cancelFilter();
      // Emptying the field is the one case that must not wait: it is how a
      // person gets the tree back, and there is nothing to compute for it.
      if (value.length === 0) {
        this.query = "";
        this.requestRender();
        return;
      }
      this.filterTimer = window.setTimeout(() => {
        this.filterTimer = null;
        this.query = value;
        this.requestRender();
      }, FILTER_DEBOUNCE_MS);
    });

    // Drawn after the field so CSS can hide it while the field is empty,
    // without the view having to track that.
    const clear = filter.createEl("button", {
      cls: "schreibstube-explorer-filter-clear",
      attr: { type: "button", "aria-label": t().explorer.clearFilter }
    });
    applyIcon(clear, "x");
    clear.addEventListener("click", () => {
      search.value = "";
      this.cancelFilter();
      this.query = "";
      this.requestRender();
      // The point of clearing is to type something else.
      search.focus();
    });

    this.shelf = root.createDiv({ cls: "schreibstube-explorer-shelf" });
    this.body = root.createDiv({ cls: "schreibstube-explorer-body" });
    this.body.addEventListener("scroll", () => this.syncShelfRule(), { passive: true });

    // The vault changes under the pane: a note created by a template, a file
    // deleted on another device and delivered by sync, frontmatter that binds a
    // note to a source. Each of those changes what a row should say.
    this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.fields.delete(file.path);
        this.requestRender();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        // Both ends: the path it had is gone, and the path it has now holds a
        // different name and different folders above it.
        this.fields.delete(oldPath);
        this.fields.delete(file.path);
        this.requestRender();
      })
    );
    // A title, an alias or a tag is frontmatter, and frontmatter changing is
    // exactly what this event says. The filter reads all three, so the file's
    // tokens are thrown away rather than left to answer for an older version.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.fields.delete(file.path);
        this.requestRender();
      })
    );
    // Every note opened, by whatever route, is found in the tree: the folders
    // above it open and its row comes into view. Nothing else is collapsed.
    this.registerEvent(this.app.workspace.on("file-open", () => this.revealActiveFile(true, true)));
    // A pane dragged to the other sidebar sits on a different ground.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.requestRender();
        this.scheduleGround();
      })
    );
    // A theme swap repaints everything the ground was measured from. A frame
    // later, so the new stylesheet has been applied by the time it is read.
    this.registerEvent(this.app.workspace.on("css-change", () => this.scheduleGround()));
    // Light and dark are a class on the body, and switching between them does
    // not always announce itself as a CSS change: a header measured in the
    // light stayed light after the switch, a pale band on a dark pane. The
    // class is watched directly, which catches the toggle whoever made it —
    // a command, the settings, or the system at dusk.
    const body = this.containerEl.ownerDocument.body;
    const themeWatch = new MutationObserver(() => this.scheduleGround());
    themeWatch.observe(body, { attributes: true, attributeFilter: ["class"] });
    this.register(() => themeWatch.disconnect());
    // How many pinned rows the strip may hold is a share of the pane, so a
    // phone turning on its side or a sidebar dragged wider changes the answer.
    this.registerEvent(this.app.workspace.on("resize", () => this.requestRender()));

    // A pointer coming up anywhere ends whatever was being dragged. A row the
    // pane destroyed mid-gesture never delivers its own release, and a drag
    // left standing holds back every redraw after it.
    this.registerDomEvent(this.containerEl.win, "pointerup", () => this.drag.end());
    this.registerDomEvent(this.containerEl.win, "pointercancel", () => this.drag.end());

    // The same button Obsidian's own explorer carries, in the same place and
    // with the same icon. Obsidian raises no event when its own is pressed and
    // registers no command for it, so the pane cannot follow along; it brings
    // its own instead.
    this.addAction("chevrons-down-up", t().explorer.collapseAll, () => this.collapseAll());

    this.measureGround();
    this.revealActiveFile(false);

    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.cancelFilter();
    if (this.groundFrame !== null) this.containerEl.win.cancelAnimationFrame(this.groundFrame);
    this.groundFrame = null;
    this.contentEl.empty();
  }

  private cancelFilter(): void {
    if (this.filterTimer !== null) window.clearTimeout(this.filterTimer);
    this.filterTimer = null;
  }

  /**
   * Put a folder on screen, opened, with its ancestors opened above it.
   *
   * This is what a `vault://` bookmark does. The pane owns the tree, so it
   * reveals in itself rather than handing the job to Obsidian's explorer, which
   * may not even be open.
   */
  revealFolder(path: string): void {
    for (const ancestor of ancestorsOf(path)) this.revealedFolders.add(ancestor);
    this.revealedFolders.add(path);
    this.reveal(path);
  }

  /**
   * Put the file being edited on screen, wherever in the vault it lives.
   *
   * A note is usually reached by some other route — the quick switcher, a link,
   * a search hit — and the pane would then open showing whatever folders
   * happened to be left open, with no sign of the note in front of the person.
   * Opening the pane answers "where am I" as well as "what is there".
   *
   * Only the folders above the file are opened. Nothing is collapsed, so a
   * person's own arrangement survives. `quietly` is for a note that was just
   * opened: the row is brought into view only if it is out of it.
   */
  revealActiveFile(redraw = true, quietly = false): void {
    const path = this.app.workspace.getActiveFile()?.path;
    if (!path) {
      if (redraw) this.requestRender();
      return;
    }

    for (const ancestor of ancestorsOf(path)) this.revealedFolders.add(ancestor);
    this.reveal(path, redraw, quietly);
  }

  private reveal(path: string, redraw = true, quietly = false): void {
    this.revealedTree = true;
    this.revealing = path;
    this.revealingQuietly = quietly;
    // The caller sometimes draws immediately afterwards, and queueing a frame
    // as well would rebuild the whole tree a second time for nothing.
    if (redraw) this.requestRender();
  }

  /**
   * Find the colour actually painted behind the pane.
   *
   * A header that holds the top of the list has to paint something, or rows
   * show through where it sits. Naming a variable for that was wrong: which one
   * is right depends on where the pane was docked and on what the theme does to
   * its sidebar, and getting it wrong leaves a grey block on every header.
   *
   * The one colour that is certainly right is the one already behind the pane,
   * so it is read off the first ancestor that paints at all.
   */
  private measureGround(): void {
    const layers: string[] = [];
    let element: HTMLElement | null = this.containerEl;
    while (element) {
      layers.push(getComputedStyle(element).backgroundColor);
      element = element.parentElement;
    }

    // Not the first ancestor that paints, but all of them laid over each
    // other: with window translucency the sidebar is a tint, and a tint
    // painted solid on the header is the wrong colour. See ground-colour.
    const colour = groundColour(layers);
    if (colour) this.contentEl.style.setProperty("--schreibstube-ground", colour);
    else this.contentEl.style.removeProperty("--schreibstube-ground");
  }

  /** One measurement per frame, however many signals asked for it. */
  private scheduleGround(): void {
    if (this.groundFrame !== null) return;
    this.groundFrame = this.containerEl.win.requestAnimationFrame(() => {
      this.groundFrame = null;
      this.measureGround();
    });
  }

  /**
   * Close every folder in the tree.
   *
   * Both sets go: what a person opened by hand and what a reveal opened for
   * them. Closing everything and leaving a folder open because the pane had
   * shown a file in it would be the one thing this button must not do.
   *
   * Sections are left alone. They are not folders, and a person who closed the
   * bookmarks list did not ask about them.
   */
  collapseAll(): void {
    this.expanded.clear();
    this.revealedFolders.clear();
    this.writeMemory();
    this.requestRender();
  }

  /**
   * Open every folder in the tree.
   *
   * The section holding them is opened with them: folders opened inside a
   * section that is closed are a button that visibly does nothing.
   */
  expandAll(paths: readonly string[] = folderPathsUnder(this.app.vault.getRoot())): void {
    for (const path of paths) this.expanded.add(path);
    this.collapsedSections.delete("files");
    this.writeMemory();
    this.requestRender();
  }

  /** Collapse the redraws a burst of vault events would otherwise cause. */
  private requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    window.requestAnimationFrame(() => {
      this.pending = false;
      // A drag in progress holds the redraw and runs it when it ends.
      if (this.drag.holdsRedraw()) return;
      this.render();
    });
  }

  private render(): void {
    const host = this.body;
    if (!host || !this.host) return;

    host.empty();
    this.shelf?.empty();
    const filtered = this.collectMatches();
    this.matches = filtered?.all ?? null;
    this.treeMatches = filtered?.tree ?? null;
    this.drawnMatches = 0;
    this.folderCounts.clear();
    // The rows a drag was holding are about to be thrown away.
    this.drag.reset();
    this.openPaths = this.collectOpenPaths();
    const settings = this.host.settings();

    if (this.shelf) this.renderPinned(this.shelf, host);
    if (settings.explorerBookmarksEnabled) this.renderBookmarks(host);
    if (settings.explorerLatestEnabled) this.renderLatest(host);
    this.renderFiles(host);

    this.scrollToRevealed();
    this.syncShelfRule();
  }

  /**
   * Show the strip's rule only while something is scrolled under it.
   *
   * At rest the strip is part of the pane and needs no line around it. The
   * moment a fourth pinned row, or the section below, has gone past, the line
   * says the strip is holding rows back rather than simply being first.
   */
  private syncShelfRule(): void {
    if (!this.shelf || !this.body) return;
    this.shelf.toggleClass("is-scrolled", this.body.scrollTop > 0);
    this.syncStuckHeaders();
  }

  /**
   * Mark whichever header is currently holding the top of the list.
   *
   * CSS can hold an element there but cannot say that it is doing so, and the
   * fade below a header belongs only to the one that has rows sliding under it.
   * A header sitting in its natural place in the list must not cast it.
   */
  private syncStuckHeaders(): void {
    const body = this.body;
    if (!body) return;

    const top = body.getBoundingClientRect().top;
    for (const header of Array.from(
      body.querySelectorAll<HTMLElement>(".schreibstube-explorer-section-header")
    )) {
      const held = Math.abs(header.getBoundingClientRect().top - top) < STUCK_TOLERANCE_PX;
      header.toggleClass("is-stuck", held);
    }
  }

  // --- sections -----------------------------------------------------------

  /**
   * A section's header and, when it is open, the body to draw into.
   *
   * Whether it is open is decided here, from what the pane remembers, what a
   * reveal opened and what a filter forces; the header itself is drawn beside.
   */
  private renderSection(
    host: HTMLElement,
    id: SectionId,
    icon: string,
    options: SectionOptions = {}
  ): HTMLElement | null {
    const collapsed =
      this.collapsedSections.has(id) &&
      !(id === "files" && this.revealedTree) &&
      options.forceOpen !== true;

    return renderSectionHeader(host, {
      id,
      icon,
      collapsed,
      options,
      toggle: () => this.toggleSection(id, collapsed),
      acknowledge: (alert) => this.acknowledgeAlert(id, alert)
    });
  }

  private toggleSection(id: SectionId, collapsed: boolean): void {
    if (collapsed) {
      this.collapsedSections.delete(id);
    } else {
      this.collapsedSections.add(id);
      if (id === "files") this.revealedTree = false;
    }
    this.writeMemory();
    this.requestRender();
  }

  /**
   * Take the mark down, and show what it was about.
   *
   * Opened rather than toggled: the mark is an invitation to look, and a press
   * that answered it by closing the list would be a joke.
   */
  private acknowledgeAlert(id: SectionId, alert: SectionAlert): void {
    this.collapsedSections.delete(id);
    this.writeMemory();
    alert.acknowledge();
    this.requestRender();
  }

  private renderPinned(shelf: HTMLElement, scroller: HTMLElement): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    // A file answers through the filter's own ranking, which already reads the
    // title a pinned row is drawn by — so typing the name on screen can no
    // longer hide the row showing it. A folder has no fields to be ranked on,
    // and a tag is not a file at all: both are matched as the text they are.
    const items = controller
      .pinnedItems()
      .filter((item) =>
        item.kind === "tag"
          ? this.matchesQuery(`#${item.tag}`, ["all", "name", "tags"])
          : item.file instanceof TFolder
            ? this.matchesQuery(item.file.name)
            : this.matchesFile(item.file.path)
      );
    if (items.length === 0) return;

    const order = items.map((item) => item.key);
    // Every pinned tag is counted in the same walk over the vault, so a block
    // of tags costs what one does.
    const tallies = controller.tagTallies(
      items.flatMap((item) => (item.kind === "tag" ? [item.tag] : []))
    );
    // Closing the block keeps the rows that were always on screen anyway — the
    // strip is sticky, so those three cost nothing to leave — and takes away
    // the ones that continue into the scrolling list below.
    // A filter opens the block for as long as it is set. A row that matches
    // what was typed must not be the one row the chevron is sitting on.
    const filtering = this.query.length > 0;
    // Closed, the header carries the number of pins there are — the three on
    // the strip are not the block, and the count says how much of it is behind
    // the chevron without arithmetic.
    const more = !filtering && items.length > FIXED_PINNED_ROWS;
    const closed = !filtering && this.collapsedSections.has("pinned");
    const body = this.renderSection(shelf, "pinned", "pinned", {
      keepBodyWhenClosed: true,
      total: more ? items.length : 0,
      // Only while there is a rest to bring out, which a filter never leaves:
      // the filter opens the block for as long as it is set, and a band that
      // took a press while it had nothing to hide would pocket a collapse that
      // nothing on screen could show and nothing could take back.
      closable: more,
      forceOpen: filtering,
      // The chevron sits at the far end of the band instead, where the tree's
      // own control is: this one does not open and close a list, it lets the
      // shortlist past the three rows that are on screen whatever it says. It
      // points the way the list will move — down to bring the rest out, up to
      // put them away — and it is drawn only when there is a rest to bring out.
      twisty: false,
      ...(more
        ? {
            action: {
              icon: closed ? "chevron-down" : "chevron-up",
              fallbackIcon: closed ? "chevron-down" : "chevron-up",
              label: closed ? t().explorer.pinnedMore : t().explorer.pinnedFewer,
              expanded: !closed,
              run: () => this.toggleSection("pinned", closed)
            }
          }
        : {})
    });
    if (!body) return;

    const drawn = closed ? items.slice(0, FIXED_PINNED_ROWS) : items;
    // Open, the strip holds as many as half the pane has room for; the rest
    // continue in the scrolling list, as they always have.
    const sticky = closed ? FIXED_PINNED_ROWS : this.shelfCapacity();

    for (const [index, item] of drawn.entries()) {
      const host = index < sticky ? body : scroller;
      if (item.kind === "tag") {
        this.renderPinnedTagRow(host, item, tallies.get(item.tag), order);
      } else {
        this.renderPinnedRow(host, item.file, order);
      }
    }
  }

  /**
   * How many rows the open strip may hold, in rows rather than pixels.
   *
   * Measured against the pane it is in rather than assumed, so the answer
   * follows the window being resized, a sidebar being dragged wider, and a
   * phone turning on its side. Never fewer than the strip keeps while closed:
   * opening a block must not show less of it than closing it does.
   */
  private shelfCapacity(): number {
    const root = this.shelf?.parentElement;
    if (!root) return FIXED_PINNED_ROWS;

    const rowHeight = this.rowHeight();
    // The section's own header sits in the strip and takes a row's worth.
    const budget = root.clientHeight * SHELF_SHARE_OF_PANE - rowHeight;

    return Math.max(FIXED_PINNED_ROWS, Math.floor(budget / rowHeight));
  }

  /** The row height the theme is actually using, from the pane's own variable. */
  private rowHeight(): number {
    const root = this.shelf?.parentElement;
    if (!root) return FALLBACK_ROW_HEIGHT_PX;

    const declared = getComputedStyle(root).getPropertyValue("--schreibstube-row-height");
    const height = Number.parseFloat(declared);

    return Number.isFinite(height) && height > 0 ? height : FALLBACK_ROW_HEIGHT_PX;
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
    // A pinned row is a shortlist entry, there to be recognised rather than
    // located, so it draws what the note calls itself when it says. The tree
    // below keeps filenames: that is where a file is looked for by name.
    row.createSpan({
      cls: "schreibstube-explorer-name",
      text: controller.titleFor(file) ?? displayName(file)
    });
    if (file instanceof TFile) {
      this.renderBadge(row, file);
      this.renderTaskCount(row, file);
    }

    this.wirePinnedDrag(row, file.path, order);

    // The same press the tree answers: a pinned row wired to a bare click and
    // right click had no way to its menu on a phone, where a long press is the
    // only right click there is. A pinned folder shows where it is rather
    // than opening a second copy of the tree inside the section.
    wirePress(row, {
      isDragging: () => this.drag.active !== null,
      activate: () => {
        if (isFolder) this.revealFolder(file.path);
        else void controller.open(file, false);
      },
      showMenu: (at) => controller.showMenu(file, at)
    });
  }

  /**
   * A pinned tag: its name, and the open tasks of every note carrying it.
   *
   * The count is drawn whether or not rows count their own tasks. A tag is
   * pinned for this figure, and a tag row without it would only be a link to
   * the list the press opens.
   */
  private renderPinnedTagRow(
    host: HTMLElement,
    item: { key: string; tag: string },
    tally: TaskTally | undefined,
    order: string[]
  ): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const row = host.createDiv({ cls: "schreibstube-explorer-row is-pinned-entry is-tag" });
    indent(row, 0);
    row.setAttribute("title", t().explorer.tags.rowLabel(item.tag));
    row.setAttribute("data-path", item.key);

    row.createSpan({ cls: "schreibstube-explorer-twisty" });
    applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), "tag");
    row.createSpan({ cls: "schreibstube-explorer-name", text: `#${item.tag}` });

    const label = tally ? taskCountLabel(tally) : null;
    if (tally && label !== null) {
      const el = row.createSpan({ cls: "schreibstube-explorer-tasks", text: label });
      el.setAttribute("aria-label", t().explorer.taskCount(tally.open, tally.total));
    }

    this.wirePinnedDrag(row, item.key, order);

    wirePress(row, {
      isDragging: () => this.drag.active !== null,
      activate: () => void controller.openTag(item.tag),
      showMenu: (at) => controller.showTagMenu(item, at)
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
    if (!sections) return;

    const body = this.renderSection(host, "latest", "clock", {
      ...(sections.syncAlert()
        ? {
            alert: {
              label: t().explorer.latest.alert,
              acknowledge: () => sections.acknowledgeSync()
            }
          }
        : {})
    });
    if (!body) return;

    const { synced, created, modified } = sections.latestFiles();
    const labels = t().explorer.latest;

    // The source having changed is the most specific thing that can be said
    // about why a note moved, so it is said first.
    const drawn =
      this.renderLatestGroup(body, labels.synced, synced, true) +
      this.renderLatestGroup(body, labels.created, created) +
      this.renderLatestGroup(body, labels.modified, modified);

    if (drawn === 0) {
      body.createEl("p", { cls: "schreibstube-explorer-empty", text: labels.empty });
    }
  }

  private renderLatestGroup(
    host: HTMLElement,
    label: string,
    files: readonly LatestCandidate[],
    withBadge = false
  ): number {
    const controller = this.host?.explorer;
    // A file deleted a moment ago is gone from the tree at once; it would be
    // odd for it to sit on in a list two sections above.
    const matching = files.filter(
      (file) => this.matchesFile(file.path) && controller?.isTrashed(file.path) !== true
    );
    if (matching.length === 0) return 0;

    host.createDiv({ cls: "schreibstube-explorer-subheading", text: label });

    for (const file of matching) {
      const row = host.createDiv({ cls: "schreibstube-explorer-row is-latest" });
      indent(row, 0);
      row.setAttribute("title", file.path);
      this.markOpenState(row, file.path);

      row.createSpan({ cls: "schreibstube-explorer-twisty" });
      // Recent lists hold notes, and a drawing is a note to the vault: it is
      // drawn and named by the tree's rules, not as a text note.
      const fileName = basenameOf(file.path);
      const glyph = fileGlyph(null, { kind: "file", extension: "md", name: fileName });
      applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), glyph);
      row.createSpan({
        cls: "schreibstube-explorer-name",
        text: fileNameParts(fileName, "md").stem
      });
      // The same mark the tree carries, so a row here says whether the change
      // is waiting to be looked at or already in the note.
      const target = this.app.vault.getAbstractFileByPath(file.path);
      if (target instanceof TFile) {
        if (withBadge) this.renderBadge(row, target);
        this.renderTaskCount(row, target);
      }

      row.addEventListener("click", () => void this.host?.sections.openLatest(file.path));
    }

    return matching.length;
  }

  /**
   * The one control over the whole tree, on the header of the section it acts
   * on rather than on the pane's title bar, where a phone does not show it.
   *
   * One button and not two: it offers to close while anything is open and to
   * open only once everything is shut, so pressing it twice puts the tree back
   * where it was.
   */
  private treeToggle(): SectionAction | undefined {
    // A filter opens every folder holding a match for as long as it is set.
    // Closing them would undo itself on the next keystroke, and opening them is
    // what the filter is already doing.
    if (this.query.length > 0) return undefined;

    const paths = folderPathsUnder(this.app.vault.getRoot());
    if (paths.length === 0) return undefined;

    if (treeAction(paths, (path) => this.isFolderOpen(path)) === "collapse") {
      return {
        icon: "chevrons-up",
        fallbackIcon: "chevrons-down-up",
        label: t().explorer.collapseAll,
        run: () => this.collapseAll()
      };
    }

    return {
      icon: "chevrons-down",
      fallbackIcon: "chevrons-up-down",
      label: t().explorer.expandAll,
      run: () => this.expandAll(paths)
    };
  }

  private renderFiles(host: HTMLElement): void {
    const action = this.treeToggle();
    const body = this.renderSection(host, "files", "folder", action ? { action } : {});
    if (!body) return;

    const tree = body.createDiv({ cls: "schreibstube-explorer-tree" });
    const drawn = this.renderChildren(tree, this.app.vault.getRoot(), 0);

    if (drawn === 0) {
      tree.createEl("p", { cls: "schreibstube-explorer-empty", text: t().explorer.empty });
      return;
    }

    // A list that stopped has to say so, or the file you are looking for is
    // simply missing and nothing explains why.
    const held = this.matchCount - this.drawnMatches;
    if (this.treeMatches && held > 0) {
      tree.createEl("p", {
        cls: "schreibstube-explorer-empty",
        text: t().explorer.filterMore(held)
      });
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
      // Deleted a moment ago: the vault has not said so yet, and a row that
      // stays put after a confirmed delete reads as the delete having failed.
      if (controller.isTrashed(child.path)) continue;

      // While filtering, a row is drawn only if it matched or holds something
      // that did; the alternative is a tree of empty branches. The set was
      // built once for this draw and answers for folders and files alike.
      if (this.treeMatches && !this.treeMatches.has(child.path)) continue;
      if (this.treeMatches && this.drawnMatches >= FILTER_ROW_CAP) break;

      if (child instanceof TFolder) {
        this.renderRow(host, child, depth);
        drawn += 1;
        if (this.isExpanded(child)) drawn += this.renderChildren(host, child, depth + 1);
        continue;
      }

      this.renderRow(host, child, depth);
      drawn += 1;
      this.drawnMatches += 1;
    }

    return drawn;
  }

  /**
   * Whether a row that is not a vault file answers what was typed.
   *
   * A bookmark and a pinned tag are text on a row rather than a file with
   * fields, so they are matched as text. A folder falls here too: folders carry
   * no title, no tags and no path of their own to be found by.
   */
  private matchesQuery(name: string, allowed?: readonly ("all" | "name" | "tags")[]): boolean {
    if (this.query.length === 0) return true;
    return matchesText(this.query, name, allowed);
  }

  /** Whether a vault file is among what the filter kept. */
  private matchesFile(path: string): boolean {
    return this.matches === null || this.matches.has(path);
  }

  /**
   * One file's fields, tokenized once and kept until the vault says it changed.
   */
  private fieldsFor(file: TFile): SearchFields {
    const cached = this.fields.get(file.path);
    if (cached) return cached;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    const aliases = frontmatter?.aliases;
    const fields = searchFields({
      path: file.path,
      name: file.name,
      title: frontmatterTitle(frontmatter?.title),
      // Obsidian accepts an alias list or a single string, and a person editing
      // frontmatter by hand writes either.
      aliases: Array.isArray(aliases)
        ? aliases.filter((alias): alias is string => typeof alias === "string")
        : typeof aliases === "string"
          ? [aliases]
          : [],
      // `getAllTags` reads the frontmatter and the body alike, the way
      // Obsidian's own tag search sees a note, and writes each with its `#`.
      tags: (getAllTags(cache ?? {}) ?? []).map((tag) => tag.replace(/^#/, ""))
    });
    this.fields.set(file.path, fields);
    return fields;
  }

  /**
   * Every file the filter keeps, and the best of them with their folders.
   *
   * One pass over the vault, once per draw. The tree used to ask each folder
   * whether anything under it matched, and that question walked the folder's
   * whole subtree — so a subtree was walked again for every folder above it,
   * and a deep vault paid for its own depth on every keystroke.
   *
   * The cap is applied to the ranking rather than to the walk. Taking the first
   * two hundred rows in tree order means the answer depends on where in the
   * alphabet a folder sits, and the file somebody was looking for is held back
   * because a folder called `Archiv` came first.
   */
  private collectMatches(): { all: Set<string>; tree: Set<string> } | null {
    this.matchCount = 0;
    if (this.query.length === 0) return null;

    const candidates: SearchCandidate[] = [];
    for (const entry of this.app.vault.getAllLoadedFiles()) {
      if (!(entry instanceof TFile)) continue;
      candidates.push({ path: entry.path, fields: this.fieldsFor(entry) });
    }

    const hits = rankFiles(this.query, candidates);
    this.matchCount = hits.length;

    const all = new Set(hits.map((hit) => hit.path));
    const tree = new Set<string>();
    for (const hit of hits.slice(0, FILTER_ROW_CAP)) {
      tree.add(hit.path);
      for (const ancestor of ancestorsOf(hit.path)) tree.add(ancestor);
    }

    return { all, tree };
  }

  /** A filter expands the tree for as long as it is set, without disturbing
   *  what the person had opened by hand. */
  private isExpanded(folder: TFolder): boolean {
    return this.isFolderOpen(folder.path);
  }

  private isFolderOpen(path: string): boolean {
    return this.query.length > 0 || this.expanded.has(path) || this.revealedFolders.has(path);
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
    // The mark in the tree is the one that explains the row's place, which is
    // being held at the top of the folder rather than being pinned above it.
    if (controller.isKept(file.path)) row.addClass("is-pinned");
    if (file instanceof TFile) this.markOpenState(row, file.path);

    const open = isFolder && this.isExpanded(file);
    const twisty = row.createSpan({ cls: "schreibstube-explorer-twisty" });
    if (isFolder) {
      applyIcon(twisty, open ? "chevron-down" : "chevron-right");
    }

    // The glyph and its badge share a box, so the figure can sit on the corner
    // of the icon rather than after it.
    const glyph = row.createSpan({ cls: "schreibstube-explorer-glyph-box" });
    applyIcon(glyph.createSpan({ cls: "schreibstube-explorer-glyph" }), this.glyphFor(file));
    if (isFolder && !open) this.renderFolderCount(glyph, file);
    row.createSpan({ cls: "schreibstube-explorer-name", text: displayName(file) });

    if (controller.isKept(file.path)) {
      applyIcon(row.createSpan({ cls: "schreibstube-explorer-pin" }), "pinned");
    }

    if (file instanceof TFile) {
      this.renderBadge(row, file);
      this.renderTaskCount(row, file);
    }

    this.wireRow(row, file, isFolder);
    this.wireTreeDrag(row, file.path);
  }

  /**
   * How many tasks a note holds and how many are open, at the row's right
   * edge, where a menu button used to sit. That button went: a right-click
   * on a laptop and a long press on a phone reach the same menu, and a row
   * of chips that light up on hover was one more thing moving on the pane.
   *
   * Read from Obsidian's metadata, so a thousand rows cost no file reads,
   * and only where a person asked for it: most vaults have more notes than
   * task lists, and a figure on every row is noise on most of them.
   */
  private renderTaskCount(row: HTMLElement, file: TFile): void {
    if (!this.host?.settings().explorerTaskCounts || file.extension !== "md") return;

    const tally = tallyTasks(this.app.metadataCache.getFileCache(file)?.listItems);
    const label = taskCountLabel(tally);
    if (label === null) return;

    const el = row.createSpan({ cls: "schreibstube-explorer-tasks", text: label });
    el.setAttribute("aria-label", t().explorer.taskCount(tally.open, tally.total));
  }

  /**
   * Moving a file or a folder by dragging it onto a folder.
   *
   * A finger drags as a mouse does. The press that opens the context menu at
   * half a second is the same press that arms the drag, so holding still and
   * letting go gives the menu, and holding and then moving gives the drag —
   * which is the gesture a phone has taught everybody. The menu is taken away
   * the moment the row starts moving: the actions asked for by holding still
   * are not the ones wanted once something is being carried.
   *
   * The drop target is a folder row, one of the rows inside a folder, or the
   * section header, which stands for the vault root. Whether a move is allowed
   * at all is decided in `planMove`, away from the pointer, and a refusal says
   * why rather than doing nothing.
   */
  private wireTreeDrag(row: HTMLElement, path: string): void {
    const list = (): HTMLElement | null => this.body;
    this.drag.wire(row, {
      path,
      onStart: () => this.host?.explorer.closeMenu(),
      onMove: (x, y) => {
        const root = list();
        if (root) {
          markMoveTarget(root, x, y, (target) =>
            isMovePlan(this.planFor(this.drag.active ?? "", target))
          );
        }
      },
      onEnd: () => {
        const root = list();
        if (root) clearMoveMarks(root);
      },
      onDrop: (x, y) => {
        const root = list();
        void this.dropInto(path, root ? moveTargetAt(root, x, y) : null);
      }
    });
  }

  /**
   * What a closed folder is holding, on the folder's own icon.
   *
   * Counted once per draw and kept, because a folder's count is its children's
   * counts and a vault is walked once that way rather than once per row.
   */
  private renderFolderCount(host: HTMLElement, folder: TAbstractFile): void {
    if (!(folder instanceof TFolder)) return;

    const label = folderCountLabel(this.countFilesIn(folder));
    if (label === null) return;

    host.createSpan({
      cls: "schreibstube-explorer-count",
      text: label,
      attr: { "aria-label": t().explorer.folderCount(label) }
    });
  }

  private countFilesIn(folder: TFolder): number {
    const known = this.folderCounts.get(folder.path);
    if (known !== undefined) return known;

    const controller = this.host?.explorer;
    const count = countFilesUnder(folder, (path) => controller?.isTrashed(path) === true);
    this.folderCounts.set(folder.path, count);
    return count;
  }

  private planFor(source: string, targetFolder: string): ReturnType<typeof planMove> {
    const taken = new Set<string>();
    const folders = new Set<string>();

    for (const entry of this.app.vault.getAllLoadedFiles()) {
      taken.add(entry.path);
      if (entry instanceof TFolder) folders.add(entry.path);
    }

    const context: MoveContext = { taken, folders };
    return planMove(source, targetFolder, context);
  }

  private async dropInto(source: string, targetFolder: string | null): Promise<void> {
    if (targetFolder === null) return;

    const plan = this.planFor(source, targetFolder);
    if (!isMovePlan(plan)) {
      // Landing back where it started is the commonest "refusal" and is not
      // worth a message; the rest are worth saying out loud.
      if (plan !== "same-folder") {
        new Notice(t().common.notice(moveRefusalMessage(plan, basenameOf(source))));
      }
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(source);
    if (!file) return;

    try {
      await this.app.fileManager.renameFile(file, plan.destination);
    } catch {
      new Notice(t().common.notice(t().explorer.move.failed(basenameOf(source))));
    }
  }

  /** Reordering the pinned block by dragging one of its rows. Its rows sit on
   *  the shelf and in the scroller alike, so the whole pane is searched. */
  private wirePinnedDrag(row: HTMLElement, path: string, order: string[]): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const root = this.contentEl;
    this.drag.wire(row, {
      path,
      onStart: () => undefined,
      onMove: (_x, y) => markDropTarget(root, y, this.drag.active),
      onEnd: () => clearDropMarks(root),
      onDrop: (_x, y) => {
        const next = orderAfterDrop(order, path, dropAt(root, y));
        if (next) controller.reorderPinned(next);
      }
    });
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

    wirePress(row, {
      isDragging: () => this.drag.active !== null,
      activate: () => {
        if (isFolder) {
          this.toggle(file.path);
          return;
        }
        void controller.open(file, false);
      },
      showMenu: (at) => controller.showMenu(file, at)
    });
  }

  private toggle(path: string): void {
    // A folder a reveal opened is still open as far as the person clicking it
    // is concerned, so the click has to close it rather than open it again.
    if (this.expanded.has(path) || this.revealedFolders.has(path)) {
      this.expanded.delete(path);
      this.revealedFolders.delete(path);
    } else {
      this.expanded.add(path);
    }
    this.writeMemory();
    this.requestRender();
  }

  private glyphFor(file: TAbstractFile): string {
    const chosen = this.host?.explorer.iconFor(file.path);
    if (file instanceof TFolder) {
      return fileGlyph(chosen, { kind: "folder", open: this.isExpanded(file) });
    }
    if (file instanceof TFile) {
      return fileGlyph(chosen, { kind: "file", extension: file.extension, name: file.name });
    }
    return fileGlyph(chosen, { kind: "other" });
  }

  private scrollToRevealed(): void {
    const path = this.revealing;
    if (path === null || !this.body) return;

    const row = this.body.querySelector(`[data-path="${CSS.escape(path)}"]`);
    // A pane in a collapsed sidebar has no layout to scroll. The reveal waits
    // for the draw that follows the sidebar opening, rather than opening it.
    if (row instanceof HTMLElement && row.getClientRects().length === 0) return;
    this.revealing = null;
    if (!(row instanceof HTMLElement)) return;

    if (this.revealingQuietly) {
      if (!isInView(row)) row.scrollIntoView({ block: "center" });
      return;
    }

    row.scrollIntoView({ block: "center" });
    // A folder that was already on screen would otherwise jump to nowhere
    // visible; the mark says which row the bookmark meant.
    row.addClass("is-revealed");
    window.setTimeout(() => row.removeClass("is-revealed"), 1200);
  }

  // --- what the pane remembers --------------------------------------------

  private readMemory(): void {
    const { state, defaultsApplied } = stateFromMemory(readPaneMemory(this.app));
    this.collapsedSections = state.collapsedSections;
    this.collapsedBookmarks = state.collapsedBookmarks;
    this.expanded = state.expandedFolders;
    // A default applied once is written at once, so it is not applied again.
    if (defaultsApplied) this.writeMemory();
  }

  private writeMemory(): void {
    writePaneMemory(this.app, {
      collapsedSections: this.collapsedSections,
      collapsedBookmarks: this.collapsedBookmarks,
      expandedFolders: this.expanded
    });
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

/** Whether a row is wholly inside the part of its scrolling list on screen. */
function isInView(row: HTMLElement): boolean {
  let scroller = row.parentElement;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  if (!scroller) return true;
  const box = scroller.getBoundingClientRect();
  const own = row.getBoundingClientRect();
  return own.top >= box.top && own.bottom <= box.bottom;
}

function basenameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

function displayName(file: TAbstractFile): string {
  if (!(file instanceof TFile)) return file.name;
  const parts = fileNameParts(file.name, file.extension);
  return parts.hidden ? parts.stem : file.name;
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
