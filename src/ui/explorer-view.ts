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
import { openTargetOf, treeRowTarget } from "../services/pane-target";
import type { ExplorerController } from "../controllers/explorer-controller";
import type { PaneSectionsController } from "../controllers/pane-sections";
import { syncBadgeIcon, type SyncBadge } from "../services/explorer-badge";
import type { PublishMark } from "../services/publish-mark";
import {
  hasSearchWords,
  matchesText,
  MAX_QUERY_LENGTH,
  parseSearchScope,
  type SearchHit
} from "../services/file-search";
import type { Logger } from "../services/logger";
import { folderOf } from "../services/path-follow";
import { FileSearchIndex } from "../services/search-index";
import { BodyIndex, BodyLoader } from "../services/body-index";
import { fuseRankings, meaningQuery, meaningRows } from "../services/semantic/search-fusion";
import { ITEM_RESULTS_PER_SOURCE } from "../services/semantic/conversation-search";
import { sortSiblings, type ExplorerNode } from "../services/explorer-state";
import { bookmarkNoteTarget, isBookmarkTreeEmpty, type Bookmark } from "../services/bookmark-file";
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
import { DragGesture, wireListFocus, wirePress } from "./explorer-gestures";
import { readPaneMemory, stateFromMemory, writePaneMemory } from "./explorer-memory";
import {
  renderSection as renderSectionHeader,
  type SectionAction,
  type SectionAlert,
  type SectionId,
  type SectionOptions
} from "./explorer-section";
import { PendingReveal } from "../services/pending-reveal";
import { renderBookmarkRows } from "./bookmark-section";
import { basename as basenameOf } from "../services/file-name";
import { indent } from "./explorer-row";
import { applyIcon, installIconFont } from "./icon-font";
import { pressable, pressKeys } from "./pressable";
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
 * How long the typing must pause before the filter also asks by meaning.
 *
 * Longer than the redraw's pause: a meaning search runs the model once, and a
 * query caught between two words means something else than the one finished.
 * The keyword rows never wait for it; the meaning rows join them when ready.
 */
const MEANING_DEBOUNCE_MS = 300;

/** How much search by meaning can answer, least first. */
const MEANING_REACH = ["", "none", "partial", "ready"];

/** How many notes meaning may add. Past the first screenful they are noise. */
const MEANING_LIMIT = 20;

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

/** One source's item found by a search, with what its source says it is. */
export interface ItemResult {
  key: string;
  title: string;
  source: string;
  /** The source's name for its items, as a section header says it. */
  plural: string;
  icon?: string;
}

/** A source that named no icon of the set: a stack, which says "items of a kind". */
const ITEM_FALLBACK_ICON = "stack-2";

export interface ExplorerPaneHost {
  explorer: ExplorerController;
  sections: PaneSectionsController;
  settings: () => SchreibstubeSettings;
  /** Notes whose meaning answers the text, best first; empty when search by
   *  meaning is off or not ready. */
  meaning?: (text: string, limit: number) => Promise<{ id: string }[]>;
  /** Items of other plugins' sources that answer the text: they are not files,
   *  so the filter's own index never holds them. */
  items?: (text: string, limit: number) => Promise<ItemResult[]>;
  openItem?: (key: string) => void;
  /** Get ready for a search about to be typed: the filter field got focus. */
  warm?: () => void;
  /** How much meaning can answer now, and a way to hear when that moves. */
  meaningState?: () => string;
  onMeaningChange?: (listener: () => void) => () => void;
  logger: Logger;
}

export class ExplorerPaneView extends ItemView {
  private host: ExplorerPaneHost | null = null;
  private expanded = new Set<string>();
  private collapsedSections = new Set<string>();
  private collapsedBookmarks = new Set<string>();
  private query = "";
  /** The field as typed, case and all, for asking by meaning again. */
  private rawQuery = "";
  /** How many files the words alone found, and for which query. */
  private wordHits: { query: string; count: number } | null = null;
  /** What meaning could answer when it was last asked. */
  private meaningState = "";
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
  /** The redraw waiting for the next frame. */
  private renderFrame: number | null = null;
  /** The pinned-row capacity the tree was last drawn for; null before the first draw. */
  private drawnShelfCapacity: number | null = null;
  /** A resize waiting for its frame to be measured; null when none is. */
  private resizeFrame: number | null = null;
  /** Waiting for the typing to stop before the filter redraws. */
  private filterTimer: number | null = null;
  /** Waiting for a longer pause before asking by meaning. */
  private meaningTimer: number | null = null;
  private itemTimer: number | null = null;
  /** The sources' items found for a query, kept against it. */
  private itemHits: { query: string; hits: ItemResult[] } | null = null;
  /** What meaning found, and for which query; ignored once the query moved on. */
  private meaning: { query: string; hits: { path: string }[] } | null = null;
  /** The query a search by meaning is running for, so the list can say so. */
  private meaningPending: string | null = null;
  /** Rows only meaning found, so they can say why they are there. */
  private meaningOnly = new Set<string>();
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
  /** The words of every note's text, read once when the filter is first used. */
  private readonly bodies = new BodyIndex();
  private readonly bodyLoader = new BodyLoader(this.bodies, {
    paths: () => this.app.vault.getMarkdownFiles().map((file) => file.path),
    read: async (path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`not a file: ${path}`);
      return this.app.vault.cachedRead(file);
    },
    exists: (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile
  });
  /**
   * The vault as the filter reads it: names, titles, aliases and tags, read
   * once per file and kept until the vault says that file changed.
   */
  private readonly index = new FileSearchIndex(
    {
      files: () =>
        this.app.vault
          .getAllLoadedFiles()
          .filter((entry): entry is TFile => entry instanceof TFile)
          // A file deleted a moment ago is not searched: its row is gone from
          // the tree, and counted among the matches it made the list say more
          // were held back than there were.
          .filter((file) => this.host?.explorer.isTrashed(file.path) !== true)
          // A description note is found as its picture, never twice; one whose
          // picture is gone is not found at all.
          .filter((file) => this.host?.explorer.isDescriptionNote(file.path) !== true)
          .map((file) => ({ path: file.path, name: file.name })),
      metadata: (file) => {
        const target = this.app.vault.getAbstractFileByPath(file.path);
        // Gone: nothing more to read, which is a settled answer.
        if (!(target instanceof TFile)) return {};
        const cache = this.app.metadataCache.getFileCache(target);
        // A note Obsidian has not parsed yet: answered by name for now and
        // asked again on the next search, rather than remembered without its
        // title, aliases and tags until it happens to be edited.
        if (target.extension === "md" && !cache) return null;
        // A described picture carries its description note's words: the title it
        // was given, its keywords as tags, and the description itself.
        const described = this.host?.explorer.descriptionFields(file.path) ?? null;
        const keywords = Array.isArray(described?.keywords)
          ? described.keywords.filter((k): k is string => typeof k === "string")
          : [];
        return {
          title: described?.title ?? cache?.frontmatter?.title,
          aliases: cache?.frontmatter?.aliases,
          // `getAllTags` reads the frontmatter and the body alike, the way
          // Obsidian's own tag search sees a note.
          tags: [...((cache && getAllTags(cache)) ?? []), ...keywords],
          description: described?.description
        };
      },
      synced: (file) => {
        const target = this.app.vault.getAbstractFileByPath(file.path);
        const controller = this.host?.explorer;
        return target instanceof TFile && !!controller && controller.badgeFor(target) !== "none";
      }
    },
    this.bodies
  );
  /** How many files the filter matched, so a capped list can say what it is
   *  holding back. */
  private matchCount = 0;
  /** The field the filter is typed into. */
  private search: HTMLInputElement | null = null;
  /** Where a screen reader hears how many files the filter found. */
  private filterStatus: HTMLElement | null = null;
  /** The next draw answers a new query, and starts at the top of its list. */
  private queryChanged = false;
  /** Files under each folder, counted once per draw. */
  private folderCounts = new Map<string, number>();
  /** A path to scroll to once a draw has put it on screen. */
  private readonly revealing = new PendingReveal();
  /** A note just pressed in one of the pane's own lists, waiting for the
   *  file-open it causes; that one opens folders but does not scroll. */
  private panePress: PanePress | null = null;
  /** A pending ground measurement, so several signals in one frame cost one read. */
  private groundFrame: number | null = null;
  /** The shelf's rule and stuck headers waiting for the next frame. */
  private shelfFrame: number | null = null;

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
    this.meaningState = host.meaningState?.() ?? "";
    // A filter typed before meaning could answer — the model still loading, the
    // index still building — is asked again once it can, rather than keeping
    // the empty answer it got then.
    if (host.onMeaningChange) {
      this.register(
        host.onMeaningChange(() => {
          const state = host.meaningState?.() ?? "";
          if (state === this.meaningState) return;
          const more = MEANING_REACH.indexOf(state) > MEANING_REACH.indexOf(this.meaningState);
          this.meaningState = state;
          // Only when meaning can answer more than before: asking again after
          // it could answer less would ask a failed build to start over.
          if (more && this.query) this.askByMeaning(this.rawQuery, this.query);
        })
      );
    }
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
        "aria-label": t().explorer.searchPlaceholder,
        // The prefixes are the one part of the filter nothing on screen shows.
        title: t().explorer.filterHint,
        maxlength: String(MAX_QUERY_LENGTH),
        // A phone's keyboard otherwise capitalises the first letter and
        // "corrects" a file name into a dictionary word before it is searched.
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        enterkeyhint: "search"
      }
    });
    this.search = search;
    // The loupe, before the listeners so nothing depends on draw order. The
    // field used to say "filter" only through its placeholder, which is gone
    // the moment anything is typed; the glyph stays. Decorative — the field's
    // own aria-label already names what it does — so `applyIcon` hides it.
    const loupe = filter.createSpan({ cls: "schreibstube-explorer-filter-loupe" });
    applyIcon(loupe, "search");

    // Focus is the moment a search is about to be typed: the model and the
    // notes' text are got ready then, not after the first word, so the first
    // results do not wait for them.
    search.addEventListener("focus", () => {
      this.host?.warm?.();
      this.readBodies();
    });

    search.addEventListener("input", (event) => {
      // Mid-composition — an umlaut built from a dead key, a word from an
      // input method — the field holds a half-made character; the filter
      // waits for the finished one, which `compositionend` delivers.
      if ((event as InputEvent).isComposing) return;
      this.scheduleFilter();
    });
    search.addEventListener("compositionend", () => this.scheduleFilter());
    search.addEventListener("keydown", (event) => this.onFilterKey(event));

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
      this.clearFilter();
      // The point of clearing is to type something else.
      search.focus();
    });

    // How many files the filter found, said once the list has been drawn. A
    // sighted person sees the list change; without this, nobody else knew it
    // had.
    this.filterStatus = filter.createDiv({
      cls: "schreibstube-visually-hidden",
      attr: { role: "status", "aria-live": "polite" }
    });

    this.shelf = root.createDiv({ cls: "schreibstube-explorer-shelf" });
    this.body = root.createDiv({ cls: "schreibstube-explorer-body", attr: { tabindex: "0" } });
    this.body.addEventListener("scroll", () => this.scheduleShelfSync(), { passive: true });
    // Tab reaches the list here and is handed to the open note's row, where a
    // person is, or the first; a press keeps the focus it brought.
    this.register(
      wireListFocus(this.body, () => {
        const rows = this.treeRows();
        return rows.find((row) => row.hasClass("is-active")) ?? rows[0];
      })
    );
    this.wireImportDrop(this.body);

    // The vault changes under the pane: a note created by a template, a file
    // deleted on another device and delivered by sync, frontmatter that binds a
    // note to a source. Each of those changes what a row should say.
    this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.forgetDescribed(file.path);
        // A folder arrives as one event, for the folder; the files inside it
        // get none, so they are forgotten by prefix.
        this.index.forget(file.path);
        this.index.forgetUnder(file.path);
        this.bodyLoader.forget(file.path);
        this.bodyLoader.forgetUnder(file.path);
        this.requestRender();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        // Both ends: the path it had is gone, and the path it has now holds a
        // different name and different folders above it. A folder moved takes
        // everything under it along, under paths the cache has not seen.
        this.forgetDescribed(oldPath);
        this.index.forget(oldPath);
        this.index.forgetUnder(oldPath);
        this.index.forget(file.path);
        // The text moved with the file; the next filter reads it at its new path.
        this.bodyLoader.forget(oldPath);
        this.bodyLoader.forgetUnder(oldPath);
        if (this.query) this.readBodies();
        this.requestRender();
      })
    );
    // A title, an alias or a tag is frontmatter, and frontmatter changing is
    // exactly what this event says. The filter reads all three, so the file's
    // tokens are thrown away rather than left to answer for an older version.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.forgetDescribed(file.path);
        this.index.forget(file.path);
        // The cache is re-parsed after every save, so this is also the moment
        // the note's text changed.
        void this.bodyLoader.refresh(file.path).then(() => {
          if (this.query) this.requestRender();
        });
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
    // A window dragged by a pixel does not, and a resize fires for every
    // pixel: redrawn on each, the tree doubled what a resize step cost the
    // whole window (measured, an empty note open). So the pane is measured
    // once per frame, after the event, where reading its height costs no
    // layout of its own, and the tree is redrawn only when the answer changed.
    this.registerEvent(this.app.workspace.on("resize", () => this.measureShelfSoon()));

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
    // The text read is this pane's; closed, it would read on into nothing.
    this.bodyLoader.cancel();
    const win = this.containerEl.win;
    if (this.renderFrame !== null) win.cancelAnimationFrame(this.renderFrame);
    if (this.resizeFrame !== null) win.cancelAnimationFrame(this.resizeFrame);
    this.renderFrame = null;
    if (this.groundFrame !== null) win.cancelAnimationFrame(this.groundFrame);
    this.groundFrame = null;
    if (this.shelfFrame !== null) win.cancelAnimationFrame(this.shelfFrame);
    this.shelfFrame = null;
    this.contentEl.empty();
    // A search by meaning or a read of the notes' text still running answers
    // into a pane that is gone. With nothing to draw into, a redraw asked for
    // afterwards is not scheduled, and what it would have drawn is dropped.
    this.body = null;
    this.shelf = null;
    this.search = null;
    this.filterStatus = null;
    this.meaningPending = null;
    this.meaning = null;
    this.itemHits = null;
  }

  private cancelFilter(): void {
    if (this.filterTimer !== null) this.containerEl.win.clearTimeout(this.filterTimer);
    this.filterTimer = null;
    if (this.meaningTimer !== null) this.containerEl.win.clearTimeout(this.meaningTimer);
    this.meaningTimer = null;
    if (this.itemTimer !== null) this.containerEl.win.clearTimeout(this.itemTimer);
    this.itemTimer = null;
  }

  /**
   * Ask the sources for their items once the typing has paused.
   *
   * A plain search only: a `tag:` or `path:` scope asks about files, and an
   * item has neither. Asked whatever the words found — a note called what was
   * typed does not make the item about it any less wanted.
   */
  private askItems(raw: string, key: string): void {
    const ask = this.host?.items;
    const scoped = parseSearchScope(key);
    if (!ask || key.length === 0 || scoped.explicit) {
      this.itemHits = null;
      return;
    }
    this.itemTimer = this.containerEl.win.setTimeout(() => {
      this.itemTimer = null;
      void ask(raw.trim(), ITEM_RESULTS_PER_SOURCE)
        .then((hits) => {
          if (this.query !== key) return;
          this.itemHits = { query: key, hits };
          this.requestRender();
        })
        .catch(() => undefined);
    }, MEANING_DEBOUNCE_MS);
  }

  /**
   * Ask by meaning once the typing has paused, and redraw when the answer comes.
   *
   * `raw` keeps its case: the model reads "Objekt" and "objekt" alike, but a
   * name it recognises is better left as typed. The answer is kept against
   * `key`, the query the filter uses, and dropped if the query moved on.
   */
  private askByMeaning(raw: string, key: string): void {
    const ask = this.host?.meaning;
    if (!ask || meaningQuery(raw) === null) return;
    if (this.meaningTimer !== null) this.containerEl.win.clearTimeout(this.meaningTimer);
    this.meaningTimer = this.containerEl.win.setTimeout(() => {
      this.meaningTimer = null;
      // Asked after the pause, when the words have had their turn: one word
      // the words already answer is not asked by meaning.
      const text = meaningQuery(raw, this.wordHitsFor(key));
      if (text === null) return;
      // Said while it runs: a list of word results, or none, that is still
      // waiting for meaning read as the whole answer — "nothing matches" stood
      // on screen until the meaning rows arrived under it.
      this.meaningPending = key;
      this.requestRender();
      const settle = (): void => {
        if (this.meaningPending !== key) return;
        this.meaningPending = null;
        this.requestRender();
      };
      void ask(text, MEANING_LIMIT)
        .then((hits) => {
          if (this.query !== key || hits.length === 0) return;
          this.meaning = { query: key, hits: hits.map((hit) => ({ path: hit.id })) };
        })
        .catch(() => undefined)
        .finally(settle);
    }, MEANING_DEBOUNCE_MS);
  }

  /** How many files the words alone find for `key`, counted by the last draw
   *  when it was for this query. */
  private wordHitsFor(key: string): number {
    if (this.wordHits?.query === key) return this.wordHits.count;
    return this.index.search(key, 0).hits.length;
  }

  /** How much of the vault's text the filter has read, for the settings. Null
   *  until it has read any. */
  textStats(): { notes: number; words: number; readMs: number | null } | null {
    return this.bodies.size > 0
      ? {
          notes: this.bodies.size,
          words: this.bodies.vocabularySize,
          readMs: this.bodyLoader.lastReadMs
        }
      : null;
  }

  /**
   * Read the notes' text into the filter, once, in the background, and draw
   * again when that found anything, so a word only the text holds turns up
   * without another keystroke.
   */
  private readBodies(): void {
    void this.bodyLoader
      .ensure()
      .then((read) => {
        if (!read || !this.query) return;
        this.wordHits = null;
        this.requestRender();
      })
      .catch(() => undefined);
  }

  /** The query as the field holds it, or nothing when it asks for nothing. */
  private fieldQuery(): string {
    const value = (this.search?.value ?? "").trim();
    // `tag:` on its own or a stray `#` is a filter still being typed, not one
    // that matches nothing: the tree stays until there is a word to look for.
    return hasSearchWords(value) ? value : "";
  }

  /** Take the field's query now, without waiting for the typing to stop. */
  private applyFilter(): void {
    this.cancelFilter();
    const query = this.fieldQuery();
    if (query === this.query) return;
    this.query = query;
    this.queryChanged = true;
    this.requestRender();
  }

  private scheduleFilter(): void {
    this.cancelFilter();
    const raw = this.search?.value ?? "";
    const value = this.fieldQuery();
    this.rawQuery = raw;
    this.askByMeaning(raw, value);
    this.askItems(raw, value);
    if (value.length > 0) this.readBodies();
    // Emptying the field is the one case that must not wait: it is how a
    // person gets the tree back, and there is nothing to compute for it.
    if (value.length === 0) {
      this.applyFilter();
      return;
    }
    this.filterTimer = this.containerEl.win.setTimeout(() => {
      this.filterTimer = null;
      this.applyFilter();
    }, FILTER_DEBOUNCE_MS);
  }

  private clearFilter(): void {
    if (this.search) this.search.value = "";
    this.scheduleFilter();
  }

  /**
   * The keys a search field is expected to answer.
   *
   * Escape takes the filter away, as it does in every search box; Enter opens
   * the best match, which is the whole point of having ranked them; the down
   * arrow walks from the field into the list, where the arrows go on walking.
   */
  private onFilterKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    switch (event.key) {
      case "Escape":
        // An empty field has nothing to clear; the key is left to Obsidian.
        if (!this.search || this.search.value.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.clearFilter();
        return;
      case "Enter": {
        this.applyFilter();
        this.flushRender();
        const best = this.ranked?.[0]?.path;
        const file = best === undefined ? null : this.app.vault.getAbstractFileByPath(best);
        if (!(file instanceof TFile)) return;
        event.preventDefault();
        void this.host?.explorer.open(file, openTargetOf(Keymap.isModEvent(event)));
        return;
      }
      case "ArrowDown": {
        this.applyFilter();
        this.flushRender();
        const first = this.treeRows()[0];
        if (!first) return;
        event.preventDefault();
        first.focus();
        return;
      }
      default:
        return;
    }
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
    this.revealing.request(path, quietly);
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

  /** Put the cursor in the filter field, with any words in it selected. */
  focusFilter(): void {
    const field = this.search;
    if (!field) return;
    field.focus();
    // Words left from the last search are replaced by the first key typed,
    // which is what someone coming back to the pane to search again wants.
    field.select();
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
    this.browsed();
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
    this.browsed();
    this.writeMemory();
    this.requestRender();
  }

  /** Collapse the redraws a burst of vault events would otherwise cause. */
  private measureShelfSoon(): void {
    if (!this.body || this.resizeFrame !== null) return;
    this.resizeFrame = this.containerEl.win.requestAnimationFrame(() => {
      this.resizeFrame = null;
      const capacity = this.shelfCapacity();
      if (capacity === this.drawnShelfCapacity) return;
      this.drawnShelfCapacity = capacity;
      this.requestRender();
    });
  }

  private requestRender(): void {
    if (!this.body || this.renderFrame !== null) return;
    this.renderFrame = this.containerEl.win.requestAnimationFrame(() => {
      this.renderFrame = null;
      // A drag in progress holds the redraw and runs it when it ends.
      if (this.drag.holdsRedraw()) return;
      this.render();
    });
  }

  /**
   * Make a waiting redraw now rather than on the next frame.
   *
   * For a key that acts on what the filter found: Enter pressed in the same
   * frame as the last letter must open the best match for the whole word, not
   * for the word without its last letter.
   */
  private flushRender(): void {
    if (this.renderFrame === null) return;
    this.containerEl.win.cancelAnimationFrame(this.renderFrame);
    this.renderFrame = null;
    if (!this.drag.holdsRedraw()) this.render();
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
    const filtered = this.collectMatches();
    this.matches = filtered?.all ?? null;
    this.ranked = filtered?.ranked ?? null;
    // A selected row that is gone — deleted, moved, filtered out — is not
    // selected any more; the next "delete the selection" must not reach for
    // rows nobody can see. Folded folders are another matter: their rows are
    // one press away, so outside a filter only what is gone is dropped.
    this.selection = selectionPruned(this.selection, (path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) return false;
      if (this.matches === null) return true;
      // A folder is on screen through the filter only as a pinned row, which
      // is matched by its name.
      return file instanceof TFolder ? this.matchesQuery(file.name) : this.matches.has(path);
    });
    host.empty();
    this.shelf?.empty();
    this.folderCounts.clear();
    // The rows a drag was holding are about to be thrown away.
    this.drag.reset();
    this.openPaths = this.collectOpenPaths();
    const settings = this.host.settings();

    if (this.shelf) this.renderPinned(this.shelf, host);
    if (settings.explorerBookmarksEnabled) this.renderBookmarks(host);
    // Only a vault that mirrors sources has anything to show here.
    if (settings.syncEnabled) this.renderLatest(host);
    this.renderFiles(host);

    // A new query is a new list, read from the top; the place in the old one
    // said nothing about where to look in this one.
    host.scrollTop = this.queryChanged ? 0 : scrollTop;
    this.queryChanged = false;
    this.filterStatus?.setText(
      this.matches === null ? "" : t().explorer.filterStatus(this.matches.size)
    );
    // A row deleted from the keyboard has no row to give the focus back to;
    // the tree keeps it, so the next arrow still lands somewhere.
    if (focused !== null && !this.focusRow(focused)) host.focus();
    this.scrollToRevealed();
    this.syncShelfRule();
  }

  /** One pass per frame, however many scroll events arrived in it. */
  private scheduleShelfSync(): void {
    if (this.shelfFrame !== null) return;
    this.shelfFrame = this.containerEl.win.requestAnimationFrame(() => {
      this.shelfFrame = null;
      this.syncShelfRule();
    });
  }

  /**
   * Show the strip's rule only while something is scrolled under it, and mark
   * whichever header is holding the top of the list.
   *
   * At rest the strip is part of the pane and needs no line around it. The
   * moment a fourth pinned row, or the section below, has gone past, the line
   * says the strip is holding rows back rather than simply being first. CSS
   * can hold a header there but cannot say that it is doing so, and the fade
   * below a header belongs only to the one that has rows sliding under it.
   *
   * Every measurement is taken before any class changes: a read after a write
   * makes the browser lay the pane out again, once per header, on every frame
   * of a scroll.
   */
  private syncShelfRule(): void {
    const body = this.body;
    const shelf = this.shelf;
    if (!shelf || !body) return;

    const scrolled = body.scrollTop > 0;
    const top = body.getBoundingClientRect().top;
    const headers = Array.from(
      body.querySelectorAll<HTMLElement>(".schreibstube-explorer-section-header")
    );
    const held = headers.map(
      (header) => Math.abs(header.getBoundingClientRect().top - top) < STUCK_TOLERANCE_PX
    );

    shelf.toggleClass("is-scrolled", scrolled);
    headers.forEach((header, index) => header.toggleClass("is-stuck", held[index] === true));
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
    this.browsed();
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
    this.browsed();
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
    const capacity = this.shelfCapacity();
    this.drawnShelfCapacity = capacity;
    const sticky = closed ? FIXED_PINNED_ROWS : capacity;

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

  private showExtensions(): boolean {
    return this.host?.settings().explorerShowExtensions === true;
  }

  private renderPinnedRow(host: HTMLElement, file: TAbstractFile, order: string[]): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const isFolder = file instanceof TFolder;
    // A link rather than a tree item: the row stands for a place, and the
    // tree's own arrows and states do not apply to it. Not a Tab stop of its
    // own, as no row in the pane is; the list is the stop.
    const row = host.createDiv({
      cls: "schreibstube-explorer-row is-pinned-entry",
      attr: { role: "link", tabindex: "0" }
    });
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
      text: controller.titleFor(file) ?? displayName(file, this.showExtensions())
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
    const activate = (event?: MouseEvent): void => {
      if (isFolder) {
        this.revealFolder(file.path);
        return;
      }
      const where = event ? openTargetOf(Keymap.isModEvent(event)) : false;
      // Only a note opened in place is in front of the person; one opened
      // beside it or in another window leaves the tree free to follow.
      if (where === false) this.notePanePress(file.path);
      void controller.open(file, where);
    };
    wirePress(row, {
      isDragging: () => this.drag.active !== null,
      activate,
      showMenu: (at) => controller.showMenu(file, at)
    });
    pressKeys(row, () => activate());
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

    const row = host.createDiv({
      cls: "schreibstube-explorer-row is-pinned-entry is-tag",
      attr: { role: "link", tabindex: "0" }
    });
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
    pressKeys(row, () => void controller.openTag(item.tag));
  }

  private renderBookmarks(host: HTMLElement): void {
    const sections = this.host?.sections;
    // Opened by a filter as the other lists are: a closed section kept its
    // matching bookmarks out of sight.
    const filtering = this.query.length > 0;
    const body = this.renderSection(host, "bookmarks", "bookmark", {
      forceOpen: filtering,
      closable: !filtering
    });
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
    renderBookmarkRows(body, tree, {
      // A filter opens every folder that still has something in it, and closes
      // nothing the person had opened by hand.
      isFolded: (key) => this.query.length === 0 && this.collapsedBookmarks.has(key),
      isShown: (bookmark) => this.bookmarkShown(bookmark),
      pluginIconFor: (bookmark) => sections.pluginIconFor(bookmark),
      fold: (key) => {
        if (this.collapsedBookmarks.has(key)) this.collapsedBookmarks.delete(key);
        else this.collapsedBookmarks.add(key);
        this.browsed();
        this.writeMemory();
        this.requestRender();
      },
      open: (bookmark) => {
        // Which note a bookmark names is resolved when it opens, so the press
        // is noted without a path.
        if (bookmark.kind === "note") this.notePanePress(null);
        sections.openBookmark(bookmark);
      }
    });
  }

  /**
   * Whether a bookmark row is drawn: the filter matches its name or where it
   * leads — the same two things "Open bookmark" searches — and it is not a note
   * deleted a moment ago, which has left the tree, Latest and the pinned block
   * already and would otherwise wait here for the vault's own event.
   */
  private bookmarkShown(bookmark: Bookmark): boolean {
    if (!this.matchesQuery(bookmark.name) && !this.matchesQuery(bookmark.url)) return false;
    if (bookmark.kind !== "note") return true;

    const target = this.app.metadataCache.getFirstLinkpathDest(
      bookmarkNoteTarget(bookmark.url).linkpath,
      this.host?.sections.bookmarksPath() ?? ""
    );
    return !(target && this.host?.explorer.isTrashed(target.path));
  }

  private renderLatest(host: HTMLElement): void {
    const sections = this.host?.sections;
    if (!sections) return;

    const controller = this.host?.explorer;
    // A file deleted a moment ago is gone from the tree at once; it would be
    // odd for it to sit on in a list two sections above.
    const rows = sections
      .latestFiles()
      .synced.filter(
        (file) => this.matchesFile(file.path) && controller?.isTrashed(file.path) !== true
      );
    // A filter opens the section for as long as it is set, as it opens the
    // pinned block: a closed section hid the very notes that matched, and the
    // search read as not knowing about them. With nothing matching, the
    // section stays out of the results rather than saying it is empty.
    const filtering = this.query.length > 0;
    if (filtering && rows.length === 0) return;

    const body = this.renderSection(host, "latest", "clock", {
      forceOpen: filtering,
      closable: !filtering,
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

    // The section's own name says what the rows are; a heading over its one
    // list would only say it twice.
    const drawn = this.renderLatestRows(body, rows);

    if (drawn === 0) {
      body.createEl("p", { cls: "schreibstube-explorer-empty", text: t().explorer.latest.empty });
    }
  }

  private renderLatestRows(host: HTMLElement, files: readonly LatestCandidate[]): number {
    const controller = this.host?.explorer;
    for (const file of files) {
      const row = host.createDiv({
        cls: "schreibstube-explorer-row is-latest",
        attr: { role: "link", tabindex: "0" }
      });
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
        text: this.showExtensions() ? fileName : fileNameParts(fileName, "md").stem
      });
      // The same mark the tree carries, so a row here says whether the change
      // is waiting to be looked at or already in the note.
      const target = this.app.vault.getAbstractFileByPath(file.path);
      if (target instanceof TFile) {
        this.renderBadge(row, target);
        this.renderTaskCount(row, target);
      }

      // The same press the tree answers, so a note met here can be deleted,
      // renamed or moved without first finding it in the tree below.
      const activate = (event?: MouseEvent): void => {
        const where = event ? openTargetOf(Keymap.isModEvent(event)) : false;
        if (where === false) this.notePanePress(file.path);
        void this.host?.sections.openLatest(file.path, where);
      };
      wirePress(row, {
        isDragging: () => this.drag.active !== null,
        activate,
        showMenu: (at) => {
          const current = this.app.vault.getAbstractFileByPath(file.path);
          if (current instanceof TFile) controller?.showMenu(current, at);
        }
      });
      pressKeys(row, () => activate());
    }

    return files.length;
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
      this.renderResults(body, host);
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
  private renderResults(body: HTMLElement, host: HTMLElement): void {
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
      if (this.meaningOnly.has(file.path)) {
        result.addClass("is-meaning");
        result.setAttr("title", t().explorer.foundByMeaning);
      }
      const folder = folderOf(file);
      const label = result.createDiv({
        cls: "schreibstube-explorer-result-folder",
        text: folder.length > 0 ? folder : t().explorer.rootFolder
      });
      // The folder is part of the result, so pressing it opens what the row
      // above it names rather than doing nothing.
      label.addEventListener("click", (event) => {
        void controller?.open(file, openTargetOf(Keymap.isModEvent(event)));
      });
      drawn += 1;
    }

    const items = this.itemHits?.query === this.query ? this.itemHits.hits : [];
    this.renderItemResults(host, items);

    const searching = this.meaningPending !== null && this.meaningPending === this.query;
    if (drawn === 0 && items.length > 0) return;
    if (drawn === 0) {
      results.createEl("p", {
        cls: "schreibstube-explorer-empty",
        text: searching ? t().explorer.searchingByMeaning : t().explorer.filterEmpty
      });
      return;
    }
    if (searching) {
      results.createEl("p", {
        cls: "schreibstube-explorer-empty schreibstube-explorer-searching",
        text: t().explorer.searchingByMeaning
      });
    }

    // A list that stopped has to say so, or the file you are looking for is
    // simply missing and nothing explains why. Held back means past the cap —
    // not a hit skipped above for being deleted, which is nowhere to be shown.
    const held = this.matchCount - (this.ranked?.length ?? 0);
    if (held > 0) {
      results.createEl("p", {
        cls: "schreibstube-explorer-empty",
        text: t().explorer.filterMore(held)
      });
    }
  }

  /**
   * The sources' items under the files a search found, a section per source:
   * a row that looks like a note but opens a chat would be a trap. Each
   * header is every other section's — chevron, the source's icon, its name
   * and the rule — and each row carries the icon too, so where a row leads is
   * said on the row itself.
   */
  private renderItemResults(host: HTMLElement, hits: readonly ItemResult[]): void {
    const open = this.host?.openItem;
    if (hits.length === 0 || !open) return;
    const bySource = new Map<string, ItemResult[]>();
    for (const hit of hits) bySource.set(hit.source, [...(bySource.get(hit.source) ?? []), hit]);

    for (const [source, found] of bySource) {
      const first = found[0]!;
      const icon = first.icon ?? ITEM_FALLBACK_ICON;
      const block = this.renderSection(host, `source-${source}`, icon, {
        total: found.length,
        title: first.plural
      });
      if (!block) continue;
      for (const hit of found) {
        const row = block.createDiv({
          cls: "schreibstube-explorer-row is-item",
          attr: { role: "link", tabindex: "0", title: hit.title }
        });
        indent(row, 0);
        row.createSpan({ cls: "schreibstube-explorer-twisty" });
        applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), icon);
        row.createSpan({ cls: "schreibstube-explorer-name", text: hit.title });
        pressable(row, () => open(hit.key));
      }
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
      // A description note is its picture's words, not a row of its own; a
      // folder holding nothing else goes with them.
      if (
        child instanceof TFolder
          ? controller.hidesFolder(child)
          : controller.foldsIntoPicture(child.path)
      ) {
        continue;
      }

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

    const started = performance.now();
    const { hits, shown, searched } = this.index.search(this.query, FILTER_ROW_CAP);
    this.matchCount = hits.length;
    this.wordHits = { query: this.query, count: hits.length };
    this.meaningOnly.clear();
    this.host?.logger.debug(
      `Filter matched ${hits.length} of ${searched} files ` +
        `in ${Math.round(performance.now() - started)} ms (${this.index.size} cached)`
    );

    const controller = this.host?.explorer;
    // Asked again with what the words find now: meaning asked for one word
    // while the notes' text was still being read is noise once the text has
    // been read and the words found the notes themselves.
    const found =
      this.meaning?.query === this.query && meaningQuery(this.rawQuery, hits.length) !== null
        ? this.meaning.hits
        : [];
    if (found.length === 0 || !controller) {
      return { all: new Set(hits.map((hit) => hit.path)), ranked: shown };
    }
    // A description note is shown as its picture, as the words find it.
    // A note the index still holds but the vault no longer has is not a row.
    const rows = meaningRows(found, (path) => {
      const shown = controller.isDescriptionNote(path) ? controller.imageDescribedBy(path) : path;
      return shown !== null && this.app.vault.getAbstractFileByPath(shown) instanceof TFile
        ? shown
        : null;
    });
    const fused = fuseRankings(hits, rows);
    for (const hit of fused)
      if (hit.by.length === 1 && hit.by[0] === "meaning") this.meaningOnly.add(hit.path);
    this.matchCount = fused.length;
    return {
      all: new Set(fused.map((hit) => hit.path)),
      ranked: fused.slice(0, FILTER_ROW_CAP).map(({ path, score }) => ({ path, score }))
    };
  }

  /**
   * A note that may describe a picture changed, moved or went: the picture's
   * search fields are rebuilt from the pairing as it was and as it is now, and
   * any other file's too if the note was not a description before — cheap,
   * because pairing rebuilds lazily and only this one picture is forgotten.
   */
  private forgetDescribed(notePath: string): void {
    const controller = this.host?.explorer;
    if (!controller || !controller.touchesDescriptions(notePath)) return;
    const before =
      controller.imageDescribedBy(notePath) ??
      (controller.descriptionNoteOf(notePath) ? notePath : null);
    controller.descriptionsChanged();
    const after = controller.imageDescribedBy(notePath);
    if (before) this.index.forget(before);
    if (after && after !== before) this.index.forget(after);
    // Whether this note is now hidden changed the list the filter reads from.
    if (before || after) this.index.forget(notePath);
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
    row.createSpan({
      cls: "schreibstube-explorer-name",
      text: displayName(file, this.showExtensions())
    });

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
    // The pinned block lives in the shelf, beside the body rather than in it;
    // a pinned folder is a place to drop as much as a folder in the tree.
    const list = (): HTMLElement | null => this.shelf?.parentElement ?? this.body;
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
    const count = countFilesUnder(
      folder,
      (path) => controller?.isTrashed(path) === true || controller?.foldsIntoPicture(path) === true
    );
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

    // Last, and only a report: a picture or PDF whose description note exists.
    const described = controller.descriptionFields(file.path);
    if (described) {
      const title = typeof described.title === "string" ? described.title.trim() : "";
      const label = t().explorer.badge.described;
      const el = row.createSpan({ cls: "schreibstube-explorer-badge" });
      el.setAttribute("data-described", "true");
      el.setAttribute("aria-label", label);
      el.setAttribute("title", title ? `${label}\n${title}` : label);
      applyIcon(el, "sparkles");
      // A shortcut to the note: the click stops here, or the row would also
      // open the picture it belongs to.
      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const path = controller.descriptionNoteOf(file.path);
        const note = path ? this.app.vault.getFileByPath(path) : null;
        if (note) void controller.open(note, openTargetOf(Keymap.isModEvent(event)));
      });
    }
  }

  private wireRow(row: HTMLElement, file: TAbstractFile, isFolder: boolean): void {
    const controller = this.host?.explorer;
    if (!controller) return;

    const activate = (event?: MouseEvent): void => {
      const mod = event ? openTargetOf(Keymap.isModEvent(event)) : false;
      // The split and window chords open, as they do everywhere else; plain
      // Cmd and Shift stay with the selection, which they already mean here.
      const target = treeRowTarget(mod, event?.shiftKey === true);
      if (!isFolder && (target === "split" || target === "window")) {
        void controller.open(file, target);
        return;
      }
      const modifiers = {
        shift: event?.shiftKey === true,
        toggle: mod !== false
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
          // Not every browser has entries, whatever the DOM types say.
          const item = items[index] as
            { webkitGetAsEntry?: () => FileSystemEntry | null } | undefined;
          const entry = item?.webkitGetAsEntry?.() ?? null;
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
    this.browsed();
    this.writeMemory();
    this.requestRender();
  }

  /**
   * The person folded or unfolded something by hand.
   *
   * A reveal still waiting for the pane to have a layout — a note opened while
   * the sidebar was shut, which on a phone is every note — would land on the
   * draw this causes and pull the person away from what they just opened or
   * closed. Browsing is the answer to "where am I" they chose instead. Every
   * fold goes through here, in the tree, the bookmarks and the section headers
   * alike, so none of them can be the one that forgets.
   */
  private browsed(): void {
    this.revealing.browsed();
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
    const path = this.revealing.path;
    if (path === null || !this.body) return;

    const row = this.body.querySelector(`[data-path="${CSS.escape(path)}"]`);
    // A pane in a collapsed sidebar has no layout to scroll. The reveal waits
    // for the draw that follows the sidebar opening, rather than opening it.
    const reveal = this.revealing.settle(
      !(row instanceof HTMLElement)
        ? "missing"
        : row.getClientRects().length === 0
          ? "without-layout"
          : "on-screen"
    );
    if (reveal === null || !(row instanceof HTMLElement)) return;

    if (reveal.quietly) {
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

function displayName(file: TAbstractFile, showExtension: boolean): string {
  if (!(file instanceof TFile)) return file.name;
  const parts = fileNameParts(file.name, file.extension, showExtension);
  return parts.hidden ? parts.stem : file.name;
}

/**
 * The publication mark's title: what the note is, then what that means now.
 *
 * Times are the reader's own, as the sync mark's are.
 */
function publishMarkLines(mark: Exclude<PublishMark, { state: "none" }>): [string, string] {
  const labels = t().explorer.badge;
  // A stamp the frontmatter or a record cannot be read as a date is left out
  // rather than shown as the browser's "Invalid Date".
  const when = (iso: string): string => {
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? "" : new Date(ms).toLocaleString();
  };
  if (mark.state === "published") {
    return [labels.published(siteOf(mark.url) || mark.account, when(mark.at)), mark.url];
  }
  const lastRun = mark.lastRun ? when(mark.lastRun) : "";
  const detail = mark.recorded
    ? labels.notYetPublished
    : lastRun
      ? labels.siteLastPublished(lastRun)
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
