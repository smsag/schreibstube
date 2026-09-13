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
  Notice,
  setIcon,
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
import {
  ancestorsOf,
  isMovePlan,
  moveRefusalMessage,
  parentOf,
  planMove,
  type MoveContext
} from "../services/tree-move";
import type { SchreibstubeSettings } from "../types";
import { isLongPressEcho } from "../services/explorer-menu";
import { countFilesUnder, folderCountLabel } from "../services/folder-count";
import { folderPathsUnder, treeAction } from "../services/vault-tree";
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
 * How far a finger may travel during a long press before the press is taken
 * as the start of a scroll.
 */
const LONG_PRESS_MOVE_PX = 10;

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

/** Movement, in pixels, that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/**
 * How far a finger must travel before a press becomes a drag.
 *
 * Far further than a mouse, and the reason is the menu. On a touch screen the
 * same press opens the context menu and arms the drag at the same instant, and
 * a drag taking over closes that menu — so at a mouse's four pixels, a finger
 * resting on glass or rolling as it lifts was enough to take the menu away
 * before it could be tapped, which left no way to delete, rename or move
 * anything. Sixteen is more than half a row: a hand on its way somewhere,
 * rather than a hand staying put.
 */
const DRAG_TOUCH_THRESHOLD_PX = 16;

/** The longest a drag may hold a redraw back. Long enough for any gesture a
 *  person makes, short enough that a flag left standing is a hiccup. */
const DRAG_DEFER_MAX_MS = 5_000;

/** How close to the top or bottom of the list a drag has to be before the list
 *  starts moving under it, and how far it moves in one frame at the very edge. */
const EDGE_SCROLL_PX = 48;
const EDGE_SCROLL_MAX_PX = 12;

/**
 * What the pane remembers between sessions, per device.
 *
 * Obsidian's local storage is per vault and per device, which is the right home
 * for it: which folders a person has open on their phone is not a thing their
 * laptop should inherit, and it is not worth a sync conflict.
 */
const MEMORY_KEY = "schreibstube:explorer:view";

/**
 * Bumped when a section's default state changes, so the new default is applied
 * once per device and a person's own choice is never overwritten afterwards.
 */
const PANE_MEMORY_VERSION = 1;

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

/** A control a header carries at its far end, past the rule. */
interface SectionAction {
  /** A name in the bundled set, which is what the rest of the pane draws with. */
  icon: string;
  /** Obsidian's own name for the same thing, drawn if the set has not got it. */
  fallbackIcon: string;
  /** Named for a screen reader and on hover, because the icon alone is a guess. */
  label: string;
  run: () => void;
}

/** A mark on a section's icon, and what a tap on the mark does. */
interface SectionAlert {
  label: string;
  acknowledge: () => void;
}

/** What a section wants from its header beyond a title and a chevron. */
interface SectionOptions {
  /** Draw the body even while closed, for a section that keeps some of it. */
  keepBodyWhenClosed?: boolean;
  /** How many rows the section holds in all, named on the header while closed. */
  total?: number;
  /** False when there is nothing behind the chevron, so it is not drawn. */
  closable?: boolean;
  /** Drawn open whatever was remembered, for as long as a filter is set. */
  forceOpen?: boolean;
  /** A control of the section's own, drawn at the far end of the header. */
  action?: SectionAction;
  /** A mark on the section's icon that something came in while nobody looked. */
  alert?: SectionAlert;
  /**
   * False for a section whose chevron is drawn at the other end of the header.
   *
   * The slot itself stays, empty: every icon in the pane lines up on it, and a
   * header that dropped it would sit a chevron's width left of its own rows.
   */
  twisty?: boolean;
}

interface PaneMemory {
  /**
   * Which defaults this device has already been given.
   *
   * Without it, "closed unless you opened it" and "never recorded either way"
   * are the same absence, and a default that changes could not be applied once
   * without undoing the person's own choice every time the pane opens.
   */
  version?: number;
  /** Sections the person closed. Absent means open, which is the default. */
  collapsedSections?: string[];
  /** Bookmark folders the person closed. */
  collapsedBookmarks?: string[];
  /** Tree folders the person opened. */
  expandedFolders?: string[];
}

/** What a row hands the shared gesture. */
interface DragHandlers {
  /** Identifies the drag in progress, so one row's release cannot end another's. */
  path: string;
  /** Called once, when a press has become a drag. */
  onStart: () => void;
  onMove: (clientX: number, clientY: number) => void;
  onDrop: (clientX: number, clientY: number) => void;
  onEnd: () => void;
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
  /** Paths the filter keeps, with every folder on the way to one. Null when no
   *  filter is set, which is the difference between "everything" and "nothing". */
  private matches: Set<string> | null = null;
  /** How many files the filter matched, and how many rows have been drawn for
   *  them, so a capped list can say what it is holding back. */
  private matchCount = 0;
  private drawnMatches = 0;
  /** Files under each folder, counted once per draw. */
  private folderCounts = new Map<string, number>();
  /** A redraw a drag held back, to be run as soon as the drag has ended. */
  private deferred = false;
  /** Where the pointer is during a drag, and the frame loop that scrolls the
   *  list while it rests near an edge. */
  private dragPointer = { x: 0, y: 0 };
  private dragScroll: number | null = null;
  /** When the drag in progress began, so a flag that somehow outlives its
   *  gesture cannot hold every redraw back with it. */
  private dragStartedAt = 0;
  private dragHandlers: DragHandlers | null = null;
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
    this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestRender()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRender()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.requestRender()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.requestRender()));
    // A theme swap repaints everything the ground was measured from.
    this.registerEvent(this.app.workspace.on("css-change", () => this.measureGround()));
    // How many pinned rows the strip may hold is a share of the pane, so a
    // phone turning on its side or a sidebar dragged wider changes the answer.
    this.registerEvent(this.app.workspace.on("resize", () => this.requestRender()));

    // A pointer coming up anywhere ends whatever was being dragged. A row the
    // pane destroyed mid-gesture never delivers its own release, and a drag
    // left standing holds back every redraw after it.
    this.registerDomEvent(this.containerEl.win, "pointerup", () => this.endDrag());
    this.registerDomEvent(this.containerEl.win, "pointercancel", () => this.endDrag());

    // The same button Obsidian's own explorer carries, in the same place and
    // with the same icon. Obsidian raises no event when its own is pressed and
    // registers no command for it, so the pane cannot follow along; it brings
    // its own instead.
    this.addAction("chevrons-down-up", t().explorer.collapseAll, () => this.collapseAll());

    this.measureGround();
    this.revealActiveFile(false);

    this.render();
  }

  protected async onClose(): Promise<void> {
    this.cancelFilter();
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
   * person's own arrangement survives.
   */
  revealActiveFile(redraw = true): void {
    const path = this.app.workspace.getActiveFile()?.path;
    if (!path) return;

    for (const ancestor of ancestorsOf(path)) this.revealedFolders.add(ancestor);
    this.reveal(path, redraw);
  }

  private reveal(path: string, redraw = true): void {
    this.revealedTree = true;
    this.revealing = path;
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
    let element: HTMLElement | null = this.containerEl;

    while (element) {
      const colour = getComputedStyle(element).backgroundColor;
      if (colour && colour !== "transparent" && !colour.startsWith("rgba(0, 0, 0, 0")) {
        this.contentEl.style.setProperty("--schreibstube-ground", colour);
        return;
      }
      element = element.parentElement;
    }

    this.contentEl.style.removeProperty("--schreibstube-ground");
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

      // A redraw throws away the row the pointer is holding, and with it the
      // gesture: the capture is lost, the drop never arrives, and the move the
      // person was making silently does not happen. The vault raises events
      // throughout a drag — a note saving itself is enough — so the redraw
      // waits for the button to come up instead.
      //
      // Only for as long as a drag can plausibly last. Holding redraws is worth
      // it for the seconds a gesture takes and never worth a pane that has
      // stopped answering because a flag was left standing.
      if (this.dragging !== null && Date.now() - this.dragStartedAt < DRAG_DEFER_MAX_MS) {
        this.deferred = true;
        return;
      }

      this.render();
    });
  }

  /**
   * Scroll the list while a drag rests near its top or bottom edge.
   *
   * Without it only what is already on screen can be dropped on, which on a
   * phone is a folder or two. The loop runs per frame rather than per move,
   * because a finger held at the edge is not moving and would otherwise scroll
   * nothing, and it re-marks the target as the list slides underneath it.
   */
  private startEdgeScroll(): void {
    if (this.dragScroll !== null) return;

    const step = (): void => {
      const body = this.body;
      if (!body || this.dragging === null) {
        this.dragScroll = null;
        return;
      }

      this.dragScroll = window.requestAnimationFrame(step);

      const box = body.getBoundingClientRect();
      const above = this.dragPointer.y - box.top;
      const below = box.bottom - this.dragPointer.y;
      const speed = (distance: number): number =>
        Math.ceil(((EDGE_SCROLL_PX - distance) / EDGE_SCROLL_PX) * EDGE_SCROLL_MAX_PX);

      let moved = 0;
      if (above < EDGE_SCROLL_PX) moved = -speed(Math.max(0, above));
      else if (below < EDGE_SCROLL_PX) moved = speed(Math.max(0, below));
      if (moved === 0) return;

      const before = body.scrollTop;
      body.scrollTop += moved;
      // The rows moved under a finger that did not: what it is over now is not
      // what it was over a frame ago.
      if (body.scrollTop !== before) {
        this.dragHandlers?.onMove(this.dragPointer.x, this.dragPointer.y);
      }
    };

    this.dragScroll = window.requestAnimationFrame(step);
  }

  private stopEdgeScroll(): void {
    if (this.dragScroll !== null) window.cancelAnimationFrame(this.dragScroll);
    this.dragScroll = null;
  }

  /**
   * Let go of a drag, and run the redraw it held back.
   *
   * A tick late, because the click the release raises has to find the flag
   * still set: that click is on the row the drag just moved, and acting on it
   * would open the file that was being filed away.
   */
  private endDrag(): void {
    if (this.dragging === null && !this.deferred) return;

    window.setTimeout(() => {
      this.dragging = null;
      if (!this.deferred) return;
      this.deferred = false;
      this.requestRender();
    }, 0);
  }

  private render(): void {
    const host = this.body;
    if (!host || !this.host) return;

    host.empty();
    this.shelf?.empty();
    this.matches = this.collectMatches();
    this.drawnMatches = 0;
    this.folderCounts.clear();
    // The rows a drag was holding are about to be thrown away.
    this.dragging = null;
    this.deferred = false;
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
   * A section: a header that toggles, and a body that is simply not drawn while
   * the section is closed. Keeping the rows out of the document rather than
   * hiding them is what keeps a vault of thousands of notes cheap to redraw.
   */
  private renderSection(
    host: HTMLElement,
    id: SectionId,
    icon: string,
    options: SectionOptions = {}
  ): HTMLElement | null {
    const section = host.createDiv({ cls: "schreibstube-explorer-section" });
    const collapsed =
      this.collapsedSections.has(id) &&
      !(id === "files" && this.revealedTree) &&
      options.forceOpen !== true;
    // Nothing behind the chevron is nothing to click: a section that hides
    // nothing while closed must not offer to open.
    const closable = options.closable ?? true;

    // "Files and folders" is drawn as a band across the pane, because it is the
    // one header that separates two kinds of thing: the three curated lists
    // above it and the vault itself below.
    //
    // A div and not a button, though it behaves as one. A button carries every
    // theme's idea of what a button looks like — a fill, a hover fill, a
    // pressed fill — and a header that lit up grey under the finger that had
    // just opened it, and stayed lit, was that idea arriving where it was not
    // wanted. A row in this pane is drawn by this pane. It also stops a control
    // of the section's own from being a button inside a button.
    const header = section.createDiv({
      cls: `schreibstube-explorer-section-header${id === "files" ? " is-divider" : ""}`,
      // A header that hides nothing is a label, and says so: a role and a tab
      // stop on it would promise a keyboard something to press that is not
      // there. The class is what the pane styles and the drag aims at, either
      // way.
      attr: closable ? { role: "button", tabindex: "0", "aria-expanded": String(!collapsed) } : {}
    });
    const twisty = header.createSpan({ cls: "schreibstube-explorer-twisty" });
    if (closable && options.twisty !== false) {
      applyIcon(twisty, collapsed ? "chevron-right" : "chevron-down");
    }

    // How many there are in all, on the section's own icon: a closed section
    // showing rows does not look closed, and the rows on screen are not the
    // whole of it. The same badge a closed folder carries, in the same place,
    // because it answers the same question.
    const glyph = header.createSpan({ cls: "schreibstube-explorer-glyph-box" });
    applyIcon(glyph.createSpan({ cls: "schreibstube-explorer-glyph" }), icon);

    const total = collapsed ? folderCountLabel(options.total ?? 0) : null;
    // News first: a figure says how much is there and the mark says that some of
    // it is new, and one corner of one icon can only carry the more urgent of
    // the two. No section asks for both today.
    if (options.alert) {
      this.renderSectionAlert(glyph, id, options.alert);
    } else if (total !== null) {
      glyph.createSpan({ cls: "schreibstube-explorer-count", text: total });
    }

    header.createSpan({
      cls: "schreibstube-explorer-section-title",
      text: t().explorer.sections[id]
    });

    if (options.action) this.renderSectionAction(header, options.action);

    if (closable) {
      header.addEventListener("click", () => this.toggleSection(id, collapsed));
      // What the button it no longer is gave for nothing.
      header.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.toggleSection(id, collapsed);
      });
    }

    const body = section.createDiv({ cls: "schreibstube-explorer-section-body" });
    if (!collapsed || options.keepBodyWhenClosed) return body;

    body.detach();
    return null;
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
   * A control of the section's own, inside the header that opens the section.
   *
   * It has to stop the press reaching that header, or opening every folder in
   * the vault would close the section they are in — the one thing a control put
   * there must not do. Like the header around it, it is drawn rather than being
   * a button: nothing here should arrive wearing a theme's button.
   */
  private renderSectionAction(header: HTMLElement, action: SectionAction): void {
    const control = header.createSpan({
      cls: "schreibstube-explorer-section-action",
      attr: { role: "button", tabindex: "0", "aria-label": action.label, title: action.label }
    });

    // The glyph goes in a child of the control, never on the control itself:
    // drawing an icon marks what it is drawn on `aria-hidden`, which is right
    // for the icon and wrong for the labelled, focusable thing carrying it —
    // a control nothing can read is worse than one nobody can see.
    //
    // The bundled font first, as everywhere else in the pane, and Obsidian's
    // own icon if that font has nothing under the name. A control drawn as an
    // empty box is indistinguishable from one that is broken, and this one
    // sits alone at the end of a band with no label beside it to explain it.
    const glyph = control.createSpan();
    if (!applyIcon(glyph, action.icon)) {
      glyph.removeClass("schreibstube-icon");
      setIcon(glyph, action.fallbackIcon);
    }

    const run = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      action.run();
    };

    control.addEventListener("click", run);
    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") run(event);
    });
  }

  /**
   * The mark that something came in, worn where a folder wears its count.
   *
   * A mark and not a figure: how many sources changed is not what a person
   * wants from the corner of an icon, and the list under it says it exactly.
   *
   * It comes down when it is tapped and at no other time — not when the section
   * is merely on screen, which a pane left open all day would do by itself. The
   * tap opens the section with it, so one press both answers the mark and shows
   * what it was about.
   */
  private renderSectionAlert(glyph: HTMLElement, id: SectionId, alert: SectionAlert): void {
    const mark = glyph.createSpan({
      cls: "schreibstube-explorer-count is-alert",
      text: "!",
      attr: { role: "button", tabindex: "0", "aria-label": alert.label, title: alert.label }
    });

    const run = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      // Opened rather than toggled: the mark is an invitation to look, and a
      // tap that answered it by closing the list would be a joke.
      this.collapsedSections.delete(id);
      this.writeMemory();
      alert.acknowledge();
      this.requestRender();
    };

    mark.addEventListener("click", run);
    mark.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") run(event);
    });
  }

  private renderPinned(shelf: HTMLElement, scroller: HTMLElement): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    // A filter has to match what the row shows as well as what the file is
    // called, or typing the name on screen would hide the row showing it.
    const items = controller
      .pinnedItems()
      .filter(
        (file) => this.matchesQuery(file.name) || this.matchesQuery(controller.titleFor(file) ?? "")
      );
    if (items.length === 0) return;

    const order = items.map((file) => file.path);
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
      closable: items.length > FIXED_PINNED_ROWS,
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
              label: closed ? t().explorer.pinnedMore(items.length) : t().explorer.pinnedFewer,
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

    for (const [index, file] of drawn.entries()) {
      const host = index < sticky ? body : scroller;
      this.renderPinnedRow(host, file, order);
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
      (file) => this.matchesQuery(file.name) && controller?.isTrashed(file.path) !== true
    );
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
      // The same mark the tree carries, so a row here says whether the change
      // is waiting to be looked at or already in the note.
      if (withBadge) {
        const target = this.app.vault.getAbstractFileByPath(file.path);
        if (target instanceof TFile) this.renderBadge(row, target);
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
    const body = this.renderSection(host, "files", "folder", { action: this.treeToggle() });
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
    if (this.matches && held > 0) {
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
      if (this.matches && !this.matches.has(child.path)) continue;
      if (this.matches && this.drawnMatches >= FILTER_ROW_CAP) break;

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

  private matchesQuery(name: string): boolean {
    return this.query.length === 0 || name.toLowerCase().includes(this.query);
  }

  /**
   * Every path the filter keeps, with every folder on the way to one.
   *
   * One pass over the vault, once per draw. The tree used to ask each folder
   * whether anything under it matched, and that question walked the folder's
   * whole subtree — so a subtree was walked again for every folder above it,
   * and a deep vault paid for its own depth on every keystroke.
   */
  private collectMatches(): Set<string> | null {
    this.matchCount = 0;
    if (this.query.length === 0) return null;

    const matches = new Set<string>();
    for (const entry of this.app.vault.getAllLoadedFiles()) {
      if (entry instanceof TFolder || !this.matchesQuery(entry.name)) continue;

      this.matchCount += 1;
      matches.add(entry.path);
      for (const ancestor of ancestorsOf(entry.path)) matches.add(ancestor);
    }

    return matches;
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

    if (file instanceof TFile) this.renderBadge(row, file);

    this.renderRowActions(row, file);

    this.wireRow(row, file, isFolder);
    this.wireTreeDrag(row, file.path);
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
   * The press-hold-move gesture both drags are built on.
   *
   * A mouse begins as soon as the pointer leaves the row it pressed. A finger
   * has to hold first, because on a touch surface a short drag down a list is
   * how a person scrolls, and taking that gesture would make the pane
   * impossible to move.
   *
   * The pointer is captured on the press rather than when the drag begins, so
   * the release always comes back to this row. Without that, a press that ends
   * somewhere else leaves the row armed, and the next pointer to merely pass
   * over it starts a drag with no button held.
   */
  private wireDrag(row: HTMLElement, handlers: DragHandlers): void {
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
      this.stopEdgeScroll();
      this.dragHandlers = null;
      row.removeClass("is-dragging");
      handlers.onEnd();
      // The click that follows a pointerup would otherwise act on the row the
      // drag just moved, so the flag outlives the release by a tick.
      this.endDrag();
    };

    row.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;

      startX = event.clientX;
      startY = event.clientY;

      // Captured now, so pointerup and pointercancel cannot be delivered
      // anywhere else and leave this row armed for ever.
      row.setPointerCapture(event.pointerId);

      if (event.pointerType === "touch") {
        holdTimer = window.setTimeout(() => {
          armed = true;
          row.addClass("is-dragging");
        }, LONG_PRESS_MS);
      } else {
        armed = true;
      }
    });

    // Once the hold has armed, the finger is dragging rather than scrolling.
    // The listener has to be non-passive to be allowed to say so, and the
    // gesture is only taken after the hold, so a plain swipe still scrolls.
    row.addEventListener(
      "touchmove",
      (event: TouchEvent) => {
        if (armed) event.preventDefault();
      },
      { passive: false }
    );

    row.addEventListener("pointermove", (event: PointerEvent) => {
      // A mouse with nothing held down is hovering, not dragging.
      if (event.pointerType !== "touch" && event.buttons === 0) {
        if (this.dragging === null) armed = false;
        return;
      }

      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
      const threshold = event.pointerType === "touch" ? DRAG_TOUCH_THRESHOLD_PX : DRAG_THRESHOLD_PX;

      // A finger that moves before the hold has elapsed is scrolling the pane.
      if (!armed) {
        if (moved > threshold) clearHold();
        return;
      }
      if (this.dragging === null && moved <= threshold) return;

      if (this.dragging === null) {
        this.dragging = handlers.path;
        this.dragStartedAt = Date.now();
        this.dragHandlers = handlers;
        row.addClass("is-dragging");
        handlers.onStart();
        this.startEdgeScroll();
      }

      this.dragPointer = { x: event.clientX, y: event.clientY };
      handlers.onMove(event.clientX, event.clientY);
    });

    row.addEventListener("pointerup", (event: PointerEvent) => {
      if (this.dragging !== handlers.path) {
        finish();
        return;
      }

      const x = event.clientX;
      const y = event.clientY;
      finish();
      handlers.onDrop(x, y);
    });

    row.addEventListener("pointercancel", finish);
    // A redraw mid-drag destroys the row, and with it the capture. Without
    // this the gesture never ends and every later click is swallowed.
    row.addEventListener("lostpointercapture", () => {
      if (this.dragging === handlers.path) finish();
    });
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
    this.wireDrag(row, {
      path,
      onStart: () => this.host?.explorer.closeMenu(),
      onMove: (x, y) => this.markMoveTarget(x, y),
      onEnd: () => this.clearMoveMarks(),
      onDrop: (x, y) => void this.dropInto(path, this.moveTargetAt(x, y))
    });
  }

  /** Rows and headers a tree drag may land on. */
  private moveTargets(): HTMLElement[] {
    const root = this.body;
    if (!root) return [];

    return Array.from(
      root.querySelectorAll<HTMLElement>(
        ".schreibstube-explorer-row.is-folder[data-path], .schreibstube-explorer-section-header.is-divider"
      )
    );
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

  /**
   * File rows in the tree, each of which stands for the folder holding it.
   *
   * A file is not somewhere to put anything, but pointing at one is how a
   * person says "in there": the folder is what they are aiming at and the rows
   * inside it are what the folder looks like. Only the tree counts — the
   * curated lists above it are not a place in the vault.
   */
  private fileRows(): HTMLElement[] {
    const root = this.body;
    if (!root) return [];

    return Array.from(
      root.querySelectorAll<HTMLElement>(
        ".schreibstube-explorer-tree .schreibstube-explorer-row[data-path]:not(.is-folder)"
      )
    );
  }

  /**
   * The folder under the pointer, or null when there is none.
   *
   * A folder row answers with itself and the section header with the vault
   * root, which is the only way to drag something out of every folder it is in.
   * A file row answers with the folder it sits in, so the target a person aims
   * at is the whole block a folder occupies rather than the one row naming it.
   */
  private moveTargetAt(clientX: number, clientY: number): string | null {
    for (const element of this.moveTargets()) {
      if (!containsPoint(element, clientX, clientY)) continue;

      if (element.hasClass("schreibstube-explorer-section-header")) return "";
      return element.getAttribute("data-path");
    }

    for (const element of this.fileRows()) {
      if (!containsPoint(element, clientX, clientY)) continue;

      const path = element.getAttribute("data-path");
      // A file at the root answers with the root, as every other file answers
      // with the folder holding it.
      if (path !== null) return parentOf(path);
    }

    return null;
  }

  private markMoveTarget(clientX: number, clientY: number): void {
    this.clearMoveMarks();
    const target = this.moveTargetAt(clientX, clientY);
    if (target === null) return;

    for (const element of this.moveTargets()) {
      const isRoot = element.hasClass("schreibstube-explorer-section-header");
      const path = isRoot ? "" : element.getAttribute("data-path");
      if (path !== target) continue;
      // A folder that cannot take this row should not look as if it could.
      if (isMovePlan(this.planFor(this.dragging ?? "", target))) element.addClass("is-drop-into");
    }
  }

  private clearMoveMarks(): void {
    for (const element of this.moveTargets()) element.removeClass("is-drop-into");
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

  /** Reordering the pinned block by dragging one of its rows. */
  private wirePinnedDrag(row: HTMLElement, path: string, order: string[]): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    this.wireDrag(row, {
      path,
      onStart: () => undefined,
      onMove: (_x, y) => this.markDropTarget(y),
      onEnd: () => this.clearDropMarks(),
      onDrop: (_x, y) => {
        const next = this.orderAfterDrop(path, order, y);
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

    // Mobile has no right click and Obsidian's own long-press belongs to its
    // explorer, so the pane brings its own. The button on the row stays as the
    // way that always works.
    let timer: number | null = null;
    // When the pane's own timer last answered a press on this row, so the
    // browser's context menu for the same press can be recognised.
    let answeredAt: number | null = null;
    // Whether the press in progress has been answered with a menu. Unlike the
    // timestamp above this is not a window: a finger may rest on the row for as
    // long as the menu is being read, and everything that press raises after
    // the menu opened still belongs to it.
    let answered = false;
    // Whether a finger is on the row at all, so the browser's own context menu
    // can tell a long press from a right click without guessing at the event.
    let touching = false;
    let startX = 0;
    let startY = 0;

    const cancel = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    row.addEventListener("click", (event) => {
      // The lift that ends a long press raises a click on the row the menu is
      // standing on. Acting on it opens the file and closes the menu that the
      // press was held to open — and on a phone opening a file closes the pane
      // with it, which is why the menu looked as if it could not be used at
      // all. The row that owns the gesture swallows it instead.
      if (answered) {
        answered = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      // A drop is not a click. Without this the row the drag just moved opens
      // as well, and a folder dropped somewhere closes itself on arrival.
      if (this.dragging !== null) return;

      if (isFolder) {
        this.toggle(file.path);
        return;
      }
      void controller.open(file, false);
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      // A long press on a touch screen raises this after the pane's timer has
      // already opened a menu. A right click never does, so a second right
      // click on the same row always opens again.
      if (isLongPressEcho(Date.now(), answeredAt)) return;
      // Arriving first instead: the browser is handling the press, so the
      // pane's pending timer would only add a second menu. A finger still on
      // the row has a lift to come, and that lift must not reach the row; a
      // right click has nothing to come.
      cancel();
      if (touching) answered = true;
      controller.showMenu(file, event);
    });

    row.addEventListener(
      "touchstart",
      (event) => {
        const touch = event.touches[0];
        cancel();
        answeredAt = null;
        answered = false;
        touching = true;
        if (!touch) return;

        startX = touch.clientX;
        startY = touch.clientY;
        timer = window.setTimeout(() => {
          timer = null;
          answeredAt = Date.now();
          answered = true;
          controller.showMenu(file, { x: touch.clientX, y: touch.clientY });
        }, LONG_PRESS_MS);
      },
      { passive: true }
    );

    // A finger never holds perfectly still, so a press survives a little
    // movement. Past that the list is being scrolled, and a scroll is not a
    // long press.
    row.addEventListener(
      "touchmove",
      (event) => {
        const touch = event.touches[0];
        if (!touch) {
          cancel();
          return;
        }
        const moved = Math.hypot(touch.clientX - startX, touch.clientY - startY);
        if (moved > LONG_PRESS_MOVE_PX) cancel();
      },
      { passive: true }
    );

    // Not passive: refusing the default is the whole point. A lift the browser
    // is allowed to complete raises mouse events and a click on whatever is
    // under the finger, and Obsidian closes a menu on any press outside it — so
    // the menu the press just opened would be gone before it could be used.
    row.addEventListener("touchend", (event) => {
      cancel();
      touching = false;
      if (!answered) return;
      event.preventDefault();
      event.stopPropagation();
    });

    row.addEventListener(
      "touchcancel",
      () => {
        cancel();
        touching = false;
      },
      { passive: true }
    );
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
    let memory: PaneMemory | null = null;

    if (typeof storage.loadLocalStorage === "function") {
      try {
        const raw = storage.loadLocalStorage(MEMORY_KEY);
        if (raw && typeof raw === "object") memory = raw as PaneMemory;
      } catch {
        // A hardened setup can refuse storage entirely; the pane opens on its
        // defaults rather than failing to open.
        memory = null;
      }
    }

    if (memory) {
      this.collapsedSections = toSet(memory.collapsedSections);
      this.collapsedBookmarks = toSet(memory.collapsedBookmarks);
      this.expanded = toSet(memory.expandedFolders);
    }

    // The pinned block keeps its first rows while closed, so closed is what it
    // opens on: the shortlist and then the vault, with the rest a tap away.
    // Applied once per device — after that the chevron is the person's.
    if (memory?.version !== PANE_MEMORY_VERSION) {
      this.collapsedSections.add("pinned");
      this.writeMemory();
    }
  }

  private writeMemory(): void {
    const storage = this.app as unknown as LocalStorageApi;
    if (typeof storage.saveLocalStorage !== "function") return;

    try {
      storage.saveLocalStorage(MEMORY_KEY, {
        version: PANE_MEMORY_VERSION,
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

function basenameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

/** Whether a point on screen is inside an element's box. */
function containsPoint(element: HTMLElement, clientX: number, clientY: number): boolean {
  const box = element.getBoundingClientRect();
  return clientY >= box.top && clientY <= box.bottom && clientX >= box.left && clientX <= box.right;
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
