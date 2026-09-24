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
  Keymap,
  TFile,
  TFolder,
  View,
  type TAbstractFile,
  type WorkspaceLeaf
} from "obsidian";
import { t } from "../i18n";
import type { ExplorerController } from "../controllers/explorer-controller";
import type { PaneSectionsController } from "../controllers/pane-sections";
import { syncBadgeIcon, type SyncBadge } from "../services/explorer-badge";
import type { PublishMark } from "../services/publish-mark";
import { matchesText, type SearchHit } from "../services/file-search";
import { FileSearchIndex } from "../services/search-index";
import { sortSiblings, type ExplorerNode } from "../services/explorer-state";
import {
  bookmarkIcon,
  bookmarkLinkPath,
  isBookmarkTreeEmpty,
  type Bookmark,
  type BookmarkFolder
} from "../services/bookmark-file";
import { rowKeyAction } from "../services/explorer-keys";
import {
  EMPTY_SELECTION,
  menuActsOnSelection,
  selectionAfterClick,
  selectionExtended,
  selectionPruned,
  type SelectionState
} from "../services/explorer-selection";
import type { ImportSource } from "../controllers/explorer-controller";
import { fileGlyph, fileNameParts } from "../services/file-glyph";
import { groundColour } from "../services/ground-colour";
import { tallyTasks, type TaskTally } from "../services/task-count";
import type { LatestCandidate } from "../services/latest-files";
import {
  ancestorsOf,
  isMovePlan,
  parentOf,
  planMove,
  type MoveContext
} from "../services/tree-move";
import type { SchreibstubeSettings } from "../types";
import { countFilesUnder, folderCountLabel } from "../services/folder-count";
import { followsNoteInWindow } from "../services/follow-window";
import { scrollsToOpenedNote, type PanePress } from "../services/pane-press";
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
import { drawTaskCount } from "./task-count-label";
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
  /** The rows a menu or a key acts on together. Not remembered across
   *  sessions: a selection is a moment's intent, not a setting. */
  private selection: SelectionState = EMPTY_SELECTION;
  private pending = false;
  /** Waiting for the typing to stop before the filter redraws. */
  private filterTimer: number | null = null;
  /** Every file the filter kept, however many that is. Null when no filter is
   *  set, which is the difference between "everything" and "nothing". */
  private matches: Set<string> | null = null;
  /**
   * The best of those, in the order they were ranked, which is what the pane
   * draws in place of the tree while a filter is set.
   *
   * Kept apart from `matches` because the cap belongs to this list alone: a
   * pinned row or a note in Latest that matched must stay on screen whether or
   * not it was among the two hundred there was room to draw.
   */
  private ranked: SearchHit[] | null = null;
  /**
   * The vault as the filter reads it: names, titles, aliases and tags, read
   * once per file and kept until the vault says that file changed.
   */
  private readonly index = new FileSearchIndex({
    files: () =>
      this.app.vault
        .getAllLoadedFiles()
        .filter((entry): entry is TFile => entry instanceof TFile)
        .map((file) => ({ path: file.path, name: file.name })),
    metadata: (file) => {
      const target = this.app.vault.getAbstractFileByPath(file.path);
      if (!(target instanceof TFile)) return null;
      const cache = this.app.metadataCache.getFileCache(target);
      return {
        title: cache?.frontmatter?.title,
        aliases: cache?.frontmatter?.aliases,
        // `getAllTags` reads the frontmatter and the body alike, the way
        // Obsidian's own tag search sees a note.
        tags: getAllTags(cache ?? {})
      };
    }
  });
  /** How many files the filter matched, so a capped list can say what it is
   *  holding back. */
  private matchCount = 0;
  /** Files under each folder, counted once per draw. */
  private folderCounts = new Map<string, number>();
  /** A path to scroll to once the next draw has put it on screen. */
  private revealing: string | null = null;
  /** Whether that reveal followed a note being opened rather than a request:
   *  it then scrolls only if the row is out of view, and does not flash. */
  private revealingQuietly = false;
  /** A note just pressed in one of the pane's own lists, waiting for the
   *  file-open it causes; that one opens folders but does not scroll. */
  private panePress: PanePress | null = null;
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
    // The loupe, before the listeners so nothing depends on draw order. The
    // field used to say "filter" only through its placeholder, which is gone
    // the moment anything is typed; the glyph stays. Decorative — the field's
    // own aria-label already names what it does — so `applyIcon` hides it.
    const loupe = filter.createSpan({ cls: "schreibstube-explorer-filter-loupe" });
    applyIcon(loupe, "search");

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
      cls: "sb sb-icon schreibstube-explorer-filter-clear",
      attr: { type: "button", "aria-label": t().explorer.clearFilter }
    });
    // On a child, not on the button: `applyIcon` hides what it draws into
    // from assistive technology, and hidden the button was a focused control
    // a screen reader could not see — which the browser reports as an error.
    applyIcon(clear.createSpan(), "x");
    clear.addEventListener("click", () => {
      search.value = "";
      this.cancelFilter();
      this.query = "";
      this.requestRender();
      // The point of clearing is to type something else.
      search.focus();
    });

    this.shelf = root.createDiv({ cls: "schreibstube-explorer-shelf" });
    this.body = root.createDiv({ cls: "schreibstube-explorer-body", attr: { tabindex: "0" } });
    this.body.addEventListener("scroll", () => this.syncShelfRule(), { passive: true });
    // Tab reaches the list here and is handed straight to a row: the open
    // note's, since that is where a person is, or the first. The box itself
    // is never the thing to be on.
    this.body.addEventListener("focus", (event) => {
      if (event.target !== this.body) return;
      const rows = this.treeRows();
      (rows.find((row) => row.hasClass("is-active")) ?? rows[0])?.focus();
    });
    this.wireImportDrop(this.body);

    // The vault changes under the pane: a note created by a template, a file
    // deleted on another device and delivered by sync, frontmatter that binds a
    // note to a source. Each of those changes what a row should say.
    this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        // A folder arrives as one event, for the folder; the files inside it
        // get none, so they are forgotten by prefix.
        this.index.forget(file.path);
        this.index.forgetUnder(file.path);
        this.requestRender();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        // Both ends: the path it had is gone, and the path it has now holds a
        // different name and different folders above it. A folder moved takes
        // everything under it along, under paths the cache has not seen.
        this.index.forget(oldPath);
        this.index.forgetUnder(oldPath);
        this.index.forget(file.path);
        this.requestRender();
      })
    );
    // A title, an alias or a tag is frontmatter, and frontmatter changing is
    // exactly what this event says. The filter reads all three, so the file's
    // tokens are thrown away rather than left to answer for an older version.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.index.forget(file.path);
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
   *
   * A note in another window is left alone entirely: the pane is not where
   * the person is looking, and focusing that window would otherwise scroll
   * the pane again each time. The tree stays exactly as it was.
   */
  revealActiveFile(redraw = true, quietly = false): void {
    const path = this.app.workspace.getActiveFile()?.path;
    if (!path) {
      if (redraw) this.requestRender();
      return;
    }
    if (!followsNoteInWindow(this.activeNoteWindow(), this.containerEl.win)) return;

    for (const ancestor of ancestorsOf(path)) this.revealedFolders.add(ancestor);

    // Pressed in the pane's own lists a moment ago: the person is looking at
    // that row already, and scrolling the tree to the same note would carry
    // the pane away from it. The folders open; the scroll stays.
    const press = this.panePress;
    this.panePress = null;
    if (!scrollsToOpenedNote(path, press, Date.now())) {
      this.revealedTree = true;
      if (redraw) this.requestRender();
      return;
    }

    this.reveal(path, redraw, quietly);
  }

  /** A press on one of the pane's own rows for a note, about to open it. */
  private notePanePress(path: string | null): void {
    this.panePress = { path, at: Date.now() };
  }

  /** The window holding the view the active file is open in, or null when
   *  there is no telling — a view of any kind, since a PDF or a picture can be
   *  popped out as well as a note. */
  private activeNoteWindow(): Window | null {
    return this.app.workspace.getActiveViewOfType(View)?.containerEl.win ?? null;
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

    // Taken before the rows go. The strip measures the pane while the list is
    // empty, and that layout clamps the scroll to the top: every redraw threw
    // the place away, and a reveal then found the open note off screen and
    // centred it — after every folder opened or closed.
    const scrollTop = host.scrollTop;
    // Likewise the focus: folding a folder from the keyboard redraws the
    // tree, and the row under the focus is thrown away with the rest.
    const focused = this.focusedPath();
    // A selected row that is gone — deleted, moved, filtered out — is not
    // selected any more; the next "delete the selection" must not reach for it.
    this.selection = selectionPruned(
      this.selection,
      (path) => this.app.vault.getAbstractFileByPath(path) !== null
    );
    host.empty();
    this.shelf?.empty();
    const filtered = this.collectMatches();
    this.matches = filtered?.all ?? null;
    this.ranked = filtered?.ranked ?? null;
    this.folderCounts.clear();
    // The rows a drag was holding are about to be thrown away.
    this.drag.reset();
    this.openPaths = this.collectOpenPaths();
    const settings = this.host.settings();

    if (this.shelf) this.renderPinned(this.shelf, host);
    if (settings.explorerBookmarksEnabled) this.renderBookmarks(host);
    if (settings.explorerLatestEnabled) this.renderLatest(host);
    this.renderFiles(host);

    host.scrollTop = scrollTop;
    // A row deleted from the keyboard has no row to give the focus back to;
    // the tree keeps it, so the next arrow still lands somewhere.
    if (focused !== null && !this.focusRow(focused)) host.focus();
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
        if (isFolder) {
          this.revealFolder(file.path);
          return;
        }
        this.notePanePress(file.path);
        void controller.open(file, false);
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

    if (tally) drawTaskCount(row, tally, "schreibstube-explorer-tasks");

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
    // A note deleted a moment ago has left the tree, Latest and the pinned
    // block; this was the one list still waiting for the vault's own event.
    if (bookmark.kind === "note") {
      const target = this.app.metadataCache.getFirstLinkpathDest(
        bookmarkLinkPath(bookmark.url),
        ""
      );
      if (target && this.host?.explorer.isTrashed(target.path)) return 0;
    }

    const row = host.createDiv({ cls: "schreibstube-explorer-row is-bookmark" });
    indent(row, depth);
    row.setAttribute("data-kind", bookmark.kind);
    row.setAttribute("title", bookmark.url);

    row.createSpan({ cls: "schreibstube-explorer-twisty" });
    applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), bookmarkIcon(bookmark.kind));
    row.createSpan({ cls: "schreibstube-explorer-name", text: bookmark.name });

    row.addEventListener("click", () => {
      // Which note a bookmark names is resolved when it opens, so the press
      // is noted without a path.
      if (bookmark.kind === "note") this.notePanePress(null);
      void this.host?.sections.openBookmark(bookmark);
    });
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

      // The same press the tree answers, so a note met here can be deleted,
      // renamed or moved without first finding it in the tree below.
      wirePress(row, {
        isDragging: () => this.drag.active !== null,
        activate: () => {
          this.notePanePress(file.path);
          void this.host?.sections.openLatest(file.path);
        },
        showMenu: (at) => {
          const current = this.app.vault.getAbstractFileByPath(file.path);
          if (current instanceof TFile) controller?.showMenu(current, at);
        }
      });
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

    if (this.ranked) {
      this.renderResults(body);
      return;
    }

    const tree = body.createDiv({ cls: "schreibstube-explorer-tree", attr: { role: "tree" } });
    const drawn = this.renderChildren(tree, this.app.vault.getRoot(), 0);

    if (drawn === 0) {
      tree.createEl("p", { cls: "schreibstube-explorer-empty", text: t().explorer.empty });
    }
  }

  /**
   * What a filter draws in place of the tree: the matches, best first.
   *
   * The tree is the right shape for browsing and the wrong one for searching.
   * Drawn as a tree, results come back in folder order, which throws away the
   * ranking entirely — the best match sits wherever the alphabet put its
   * folder, and a search that worked looks exactly like the one that did not.
   * A flat list is the ranking made visible, and it is the whole reason for
   * having one.
   *
   * The cost is the context the tree gave for free, so each row carries the
   * folder it came from underneath its name. Without that, two notes called
   * `Exposé.md` are one row twice.
   */
  private renderResults(body: HTMLElement): void {
    const controller = this.host?.explorer;
    const results = body.createDiv({ cls: "schreibstube-explorer-results" });

    let drawn = 0;
    for (const hit of this.ranked ?? []) {
      const file = this.app.vault.getAbstractFileByPath(hit.path);
      // Deleted a moment ago: the vault has not said so yet, and a row that
      // stays put after a confirmed delete reads as the delete having failed.
      if (!(file instanceof TFile) || controller?.isTrashed(file.path) === true) continue;

      // The row and its folder are siblings inside one wrapper rather than the
      // folder being another item in the row: a row is one line by construction,
      // and a second line put inside it lands on the row below.
      const result = results.createDiv({ cls: "schreibstube-explorer-result" });
      const row = this.renderRow(result, file, 0);
      if (!row) {
        result.remove();
        continue;
      }
      const folder = file.parent && !file.parent.isRoot() ? file.parent.path : "";
      const label = result.createDiv({
        cls: "schreibstube-explorer-result-folder",
        text: folder.length > 0 ? folder : t().explorer.related.root
      });
      // The folder is part of the result, so pressing it opens what the row
      // above it names rather than doing nothing.
      label.addEventListener("click", (event) => {
        void controller?.open(file, Keymap.isModEvent(event) !== false);
      });
      drawn += 1;
    }

    if (drawn === 0) {
      results.createEl("p", {
        cls: "schreibstube-explorer-empty",
        text: t().explorer.filterEmpty
      });
      return;
    }

    // A list that stopped has to say so, or the file you are looking for is
    // simply missing and nothing explains why.
    const held = this.matchCount - drawn;
    if (held > 0) {
      results.createEl("p", {
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

      if (child instanceof TFolder) {
        this.renderRow(host, child, depth);
        drawn += 1;
        if (this.isExpanded(child)) drawn += this.renderChildren(host, child, depth + 1);
        continue;
      }

      this.renderRow(host, child, depth);
      drawn += 1;
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
   * Every file the filter keeps, and the best of them in the order they ranked.
   *
   * One pass over the vault, once per draw, and the reading behind it is cached
   * per file — so a keystroke costs a ranking rather than a vault.
   *
   * The cap is applied to the ranking rather than to a walk. Taking the first
   * two hundred rows in tree order meant the answer depended on where in the
   * alphabet a folder sat, and the file somebody was looking for was held back
   * because a folder called `Archiv` came first.
   */
  private collectMatches(): { all: Set<string>; ranked: SearchHit[] } | null {
    this.matchCount = 0;
    if (this.query.length === 0) return null;

    const { hits, shown } = this.index.search(this.query, FILTER_ROW_CAP);
    this.matchCount = hits.length;

    return { all: new Set(hits.map((hit) => hit.path)), ranked: shown };
  }

  /** A filter expands the tree for as long as it is set, without disturbing
   *  what the person had opened by hand. */
  private isExpanded(folder: TFolder): boolean {
    return this.isFolderOpen(folder.path);
  }

  private isFolderOpen(path: string): boolean {
    return this.query.length > 0 || this.expanded.has(path) || this.revealedFolders.has(path);
  }

  private renderRow(host: HTMLElement, file: TAbstractFile, depth: number): HTMLElement | null {
    const controller = this.host?.explorer;
    if (!controller) return null;

    const isFolder = file instanceof TFolder;
    const row = host.createDiv({ cls: "schreibstube-explorer-row" });
    indent(row, depth);
    row.setAttribute("data-path", file.path);
    row.setAttribute("role", "treeitem");
    // Reachable by keyboard, but not a Tab stop of its own: Tab lands on the
    // tree once and the arrows walk it, as every tree control does. A
    // thousand Tab stops would be a thousand presses to leave the pane.
    row.setAttribute("tabindex", "-1");
    if (isFolder) {
      row.addClass("is-folder");
      row.setAttribute("aria-expanded", String(this.isExpanded(file)));
    }
    if (this.selection.selected.has(file.path)) {
      row.addClass("is-selected");
      row.setAttribute("aria-selected", "true");
    }
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
    return row;
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

    drawTaskCount(
      row,
      tallyTasks(this.app.metadataCache.getFileCache(file)?.listItems),
      "schreibstube-explorer-tasks"
    );
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
    // The vault's paths, read once when the drag begins. Every pointer move
    // asks whether the folder under it would take the row, and walking the
    // whole vault to answer each one was the one cost in the pane that grew
    // with the vault and with how fast the hand moved.
    let context: MoveContext | null = null;
    this.drag.wire(row, {
      path,
      onStart: () => {
        this.host?.explorer.closeMenu();
        context = this.moveContext();
      },
      onMove: (x, y) => {
        const root = list();
        const known = context ?? this.moveContext();
        if (root) {
          markMoveTarget(root, x, y, (target) =>
            isMovePlan(planMove(this.drag.active ?? "", target, known))
          );
        }
      },
      onEnd: () => {
        context = null;
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

  /** Every path in the vault, and which are folders — the one walk a move needs. */
  private moveContext(): MoveContext {
    const taken = new Set<string>();
    const folders = new Set<string>();

    for (const entry of this.app.vault.getAllLoadedFiles()) {
      taken.add(entry.path);
      if (entry instanceof TFolder) folders.add(entry.path);
    }

    return { taken, folders };
  }

  /** Planned against the vault as it is now — at the drop, never from a cache,
   *  because a sync may have delivered something since the drag began. */
  private planFor(source: string, targetFolder: string): ReturnType<typeof planMove> {
    return planMove(source, targetFolder, this.moveContext());
  }

  private async dropInto(source: string, targetFolder: string | null): Promise<void> {
    if (targetFolder === null) return;
    const file = this.app.vault.getAbstractFileByPath(source);
    if (!file) return;
    // The controller plans the move, says why if it refuses, and remembers
    // it so the notice can offer to take it back.
    await this.host?.explorer.move(file, targetFolder);
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
    if (badge !== "none") {
      const label = badgeLabel(badge, controller.pendingChangesFor(file));
      const el = row.createSpan({ cls: "schreibstube-explorer-badge" });
      el.setAttribute("data-sync", badge);
      el.setAttribute("aria-label", label);
      el.setAttribute("title", `${label}\n${controller.lastCheckedFor(file)}`);
      applyIcon(el, syncBadgeIcon(badge));
    }

    // After the sync mark, which can ask for something; this one only reports.
    const mark = controller.publishMarkOf(file);
    if (mark.state !== "none") {
      const [label, detail] = publishMarkLines(mark);
      const el = row.createSpan({ cls: "schreibstube-explorer-badge" });
      el.setAttribute("data-publish", mark.state);
      el.setAttribute("aria-label", detail ? `${label}, ${detail}` : label);
      el.setAttribute("title", detail ? `${label}\n${detail}` : label);
      applyIcon(el, "world-upload");
    }
  }

  private wireRow(row: HTMLElement, file: TAbstractFile, isFolder: boolean): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const activate = (event?: MouseEvent): void => {
      const modifiers = {
        shift: event?.shiftKey === true,
        toggle: event ? Keymap.isModEvent(event) !== false : false
      };
      // A click with a modifier builds a selection and opens nothing: the
      // rows are being gathered for an action, not visited one by one.
      this.selection = selectionAfterClick(this.selection, file.path, modifiers, this.rowOrder());
      if (modifiers.shift || modifiers.toggle) {
        this.paintSelection();
        return;
      }
      this.paintSelection();
      if (isFolder) {
        this.toggle(file.path);
        // Whoever is following the pane — a tile grid, today — hears which
        // folder it was. A modifier click returned above: gathering rows for
        // an action is not choosing a folder to look at.
        controller.noteFolderChosen(file.path);
        return;
      }
      void controller.open(file, false);
    };

    wirePress(row, {
      isDragging: () => this.drag.active !== null,
      activate,
      showMenu: (at) => {
        // A menu on one of several selected rows is a menu on all of them.
        if (menuActsOnSelection(this.selection, file.path)) {
          controller.showSelectionMenu(this.selectedFiles(), at);
          return;
        }
        controller.showMenu(file, at);
      }
    });

    // The keyboard reaches everything the pointer does. Which key means what
    // is decided in `rowKeyAction`, so this is only the doing; a key the map
    // does not claim is left to the sidebar, which is what keeps Tab working.
    row.addEventListener("keydown", (event) => {
      const isOpen = isFolder && this.isFolderOpen(file.path);
      const action = rowKeyAction(event, { isFolder, isOpen });
      if (action === null) return;
      // Escape with nothing selected is not the pane's to swallow.
      if (action === "clear" && this.selection.selected.size === 0) return;
      event.preventDefault();
      event.stopPropagation();

      switch (action) {
        case "activate":
          return activate();
        case "extend-next":
        case "extend-previous": {
          const step = action === "extend-next" ? 1 : -1;
          this.selection = selectionExtended(this.selection, file.path, step, this.rowOrder());
          this.paintSelection();
          if (this.selection.cursor !== null) this.focusRow(this.selection.cursor);
          return;
        }
        case "clear":
          this.selection = EMPTY_SELECTION;
          return this.paintSelection();
        case "undo":
          return void controller.undoLast();
        case "expand":
          if (!isOpen) this.toggle(file.path);
          return;
        case "collapse":
          if (isOpen) this.toggle(file.path);
          return;
        case "next":
          return this.focusNeighbour(row, 1);
        case "previous":
          return this.focusNeighbour(row, -1);
        case "first":
          return this.treeRows()[0]?.focus();
        case "last":
          return this.treeRows().at(-1)?.focus();
        case "parent":
          this.focusRow(parentOf(file.path));
          return;
        case "delete":
          if (menuActsOnSelection(this.selection, file.path)) {
            return controller.removeMany(this.selectedFiles());
          }
          return void controller.run("delete", file);
        case "rename":
          return void controller.run("rename", file);
        case "menu": {
          // Under the row's name, where a pointer would have been.
          const box = row.getBoundingClientRect();
          const at = { x: box.left + 24, y: box.bottom };
          if (menuActsOnSelection(this.selection, file.path)) {
            return controller.showSelectionMenu(this.selectedFiles(), at);
          }
          return controller.showMenu(file, at);
        }
      }
    });
  }

  /** The tree's paths in the order they are drawn, for a range. */
  private rowOrder(): string[] {
    return this.treeRows()
      .map((row) => row.getAttribute("data-path"))
      .filter((path): path is string => path !== null);
  }

  /** The selected rows as the vault knows them, in drawn order. */
  private selectedFiles(): TAbstractFile[] {
    // From the selection, not from the rows on screen: a selected file
    // inside a folder folded since is still selected, and a menu that says
    // "3 items" must act on three.
    const files: TAbstractFile[] = [];
    for (const path of [...this.selection.selected].sort((a, b) => a.localeCompare(b))) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) files.push(file);
    }
    return files;
  }

  /**
   * Mark the selected rows, without redrawing the tree.
   *
   * A click that selects must not rebuild every row: a redraw throws away
   * the focus and the scroll, and a selection is built by several clicks in
   * a row. The classes are set on the rows that are there.
   */
  private paintSelection(): void {
    for (const row of this.treeRows()) {
      const path = row.getAttribute("data-path");
      const on = path !== null && this.selection.selected.has(path);
      row.toggleClass("is-selected", on);
      if (on) row.setAttribute("aria-selected", "true");
      else row.removeAttribute("aria-selected");
    }
  }

  /**
   * Files dragged in from the desktop.
   *
   * The pane's own drag is a pointer gesture and never raises these events;
   * anything that does is coming from outside. The folder under the pointer
   * takes the files, the section header stands for the root, and the tree
   * itself lights up to say it will take them at all.
   */
  private wireImportDrop(body: HTMLElement): void {
    const carriesFiles = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes("Files") === true;

    body.addEventListener("dragover", (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      body.addClass("is-import-target");
      // Only folders take a drop; a file row stands for the folder around it,
      // which `moveTargetAt` already knows.
      markMoveTarget(body, event.clientX, event.clientY, () => true);
    });
    body.addEventListener("dragleave", (event) => {
      if (event.relatedTarget instanceof Node && body.contains(event.relatedTarget)) return;
      body.removeClass("is-import-target");
      clearMoveMarks(body);
    });
    body.addEventListener("drop", (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      // Ours alone: a drop that also reached the window would be imported
      // twice, once by this pane and once by whatever the app does with it.
      event.stopPropagation();
      body.removeClass("is-import-target");
      clearMoveMarks(body);

      const folder = moveTargetAt(body, event.clientX, event.clientY) ?? "";
      // Whether an item is a folder is asked of the entry, which knows, and
      // read during the event — the entries are gone once it has passed.
      // A browser without entries falls back to the one sign a folder gives:
      // no type and no size, which an empty file without an extension shares.
      const items = Array.from(event.dataTransfer?.items ?? []);
      const sources: ImportSource[] = Array.from(event.dataTransfer?.files ?? []).map(
        (file, index) => {
          const entry = items[index]?.webkitGetAsEntry?.() ?? null;
          return {
            name: file.name,
            size: file.size,
            isFolder: entry ? entry.isDirectory : file.type === "" && file.size === 0,
            bytes: () => file.arrayBuffer()
          };
        }
      );
      void this.host?.explorer.importFiles(sources, folder);
    });
  }

  /** The tree's rows on screen, in reading order. Only the tree: the lists
   *  above it are reached by their own controls. */
  private treeRows(): HTMLElement[] {
    const host = this.body;
    if (!host) return [];
    return Array.from(
      host.querySelectorAll<HTMLElement>('.schreibstube-explorer-row[role="treeitem"]')
    );
  }

  private focusNeighbour(row: HTMLElement, step: 1 | -1): void {
    const rows = this.treeRows();
    const at = rows.indexOf(row);
    if (at === -1) return;
    rows[at + step]?.focus();
  }

  /** Put the focus on the row for `path`, if one is on screen. */
  private focusRow(path: string): boolean {
    const row = this.treeRows().find((candidate) => candidate.getAttribute("data-path") === path);
    if (!row) return false;
    row.focus();
    return true;
  }

  /** The path of the row holding the focus, if the focus is in the tree. */
  private focusedPath(): string | null {
    const active = this.containerEl.doc.activeElement;
    if (!(active instanceof HTMLElement) || !this.body?.contains(active)) return null;
    return active.closest<HTMLElement>("[data-path]")?.getAttribute("data-path") ?? null;
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
    // A reveal still waiting for the pane to have a layout — a note opened
    // while the sidebar was shut — would land on this draw, pulling the
    // person away from the folder they are opening. Browsing is the answer
    // to "where am I" they chose instead.
    this.revealing = null;
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

/**
 * The publication mark's title: what the note is, then what that means now.
 *
 * Times are the reader's own, as the sync mark's are.
 */
function publishMarkLines(mark: Exclude<PublishMark, { state: "none" }>): [string, string] {
  const labels = t().explorer.badge;
  const when = (iso: string): string => new Date(iso).toLocaleString();
  if (mark.state === "published") {
    return [labels.published(siteOf(mark.url) || mark.account, when(mark.at)), mark.url];
  }
  const detail = mark.recorded
    ? labels.notYetPublished
    : mark.lastRun
      ? labels.siteLastPublished(when(mark.lastRun))
      : labels.siteNeverPublished;
  return [labels.marked(mark.account), detail];
}

/** The host of a published page's address, which names the site best. */
function siteOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
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
