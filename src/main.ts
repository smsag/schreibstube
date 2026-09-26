import {
  type Editor,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TFile,
  TFolder,
  type TAbstractFile,
  type WorkspaceLeaf
} from "obsidian";
import { resolveAncestorStack } from "./services/ancestor-stack";
import { buildHeadingIndex } from "./services/heading-index";
import { reduceOverlayRowEvent, type OverlayRowEvent } from "./services/overlay-interaction";
import {
  resolveViewportLineForReadingView,
  scrollReadingHeadingIntoView
} from "./services/reading-navigator";
import { RefreshScheduler, type RefreshOptions } from "./services/refresh-scheduler";
import { OverlayCoordinator } from "./services/overlay-coordinator";
import { bootstrapSchreibstubeRuntime } from "./services/plugin-bootstrap";
import {
  DEFAULT_SETTINGS,
  holdsRetiredSettings,
  normalizeSettings
} from "./services/plugin-settings";
import { buildTaskSummaryInsertion, hasTaskSummaryBlock } from "./services/task-summary";
import { buildSlideshowInsertion } from "./services/slideshow";
import { createLogger, type Logger } from "./services/logger";
import {
  commandAvailable,
  remindersScope,
  renameTarget,
  type CommandContext,
  type GatedCommand
} from "./services/command-availability";
import { toggledFocusMode } from "./services/focus-settings";
import { getImageMimeType } from "./services/image-resize";
import { hasSourceBinding } from "./services/sync-source";
import { describePollSummary } from "./services/sync-summary";
import { mergeSyncState, sameSyncState } from "./services/sync-merge";
import type { SyncRecord } from "./services/sync-document";
import { isTaskLine, TASK_PROTOCOL_ACTION } from "./services/reminder-export";
import { sentTaskIds } from "./services/reminder-status";
import { ReminderCommands } from "./controllers/reminder-commands";
import { NoteCommands } from "./controllers/note-commands";
import { PdfCommands } from "./controllers/pdf-commands";
import { LinkModeController } from "./controllers/link-mode-controller";
import { LlmCommands } from "./controllers/llm-commands";
import { PropertyController } from "./controllers/property-controller";
import {
  convertSelectionToTable,
  insertTable,
  localTable,
  selectedLineRange
} from "./controllers/table-insert";
import { ProofreadController } from "./controllers/proofread-controller";
import { createGlossaryUnderlineExtension } from "./processors/glossary-underline";
import {
  createIconShortcodeExtension,
  registerIconShortcodePostProcessor
} from "./processors/icon-shortcode";
import { IconShortcodeSuggest } from "./ui/icon-suggest";
import { compileGlossaries } from "./services/glossary-matcher";
import { minuteOf, parseCron, previousRun, shouldFire } from "./services/cron";
import { REVIEW_VIEW_TYPE, ReviewPanelView } from "./ui/review-panel";
import { EXPLORER_RIBBON_ICON, EXPLORER_VIEW_TYPE, ExplorerPaneView } from "./ui/explorer-view";
import { TAG_NOTES_VIEW_TYPE, TagNotesView } from "./ui/tag-notes-view";
import { RELATED_NOTES_VIEW_TYPE, RelatedNotesView } from "./ui/related-notes-view";
import { FOLDER_TILES_VIEW_TYPE, FolderTilesView } from "./ui/folder-tiles-view";
import { registerSchreibstubeIcon } from "./ui/schreibstube-icon";
import { uninstallIconFont } from "./ui/icon-font";
import {
  EXPLORER_STATE_FILE,
  EXTERNAL_CHECK_MS,
  ExplorerController
} from "./controllers/explorer-controller";
import type { ExplorerFileStore } from "./services/explorer-store";
import { SemanticEngine } from "./controllers/semantic/semantic-engine";
import { createSemanticApi } from "./controllers/semantic/semantic-api";
import { recommendNotes } from "./services/semantic/recommend";
import { RecommendedFooter } from "./controllers/recommended-footer";
import type {
  PictureCard,
  Recommendation,
  RecommendedHost,
  RelatedCard
} from "./ui/recommended-panel";
import type { SchreibstubeSemanticApi } from "./services/semantic/semantic-api";
import { PaneSectionsController } from "./controllers/pane-sections";
import { BookmarkQuickOpenModal } from "./ui/bookmark-quick-open";
import { OrphanListModal } from "./ui/explorer-modals";
import { vaultUrlFor } from "./services/bookmark-file";
import { MailCommands } from "./controllers/mail-commands";
import { PublishCommands } from "./controllers/publish-commands";
import { PrintCommands } from "./controllers/print-commands";
import type { PrintTemplate } from "./services/print-template";
import { SchreibstubeSettingTab } from "./settings/index";
import { setLanguage, t } from "./i18n";
import type { FocusMode, HeadingEntry, SchreibstubeSettings } from "./types";

/** How often the poll ticker wakes. Well under a minute so a scheduled minute
 *  is never stepped over by a late tick. */
const POLL_TICK_MS = 20_000;

/** Delay before the catch-up poll, so it never competes with opening a vault. */
const POLL_CATCHUP_DELAY_MS = 8_000;

/** Delay before orphaned picture descriptions are matched, after the catch-up
 *  poll: the metadata cache has to have read the vault's frontmatter by then. */
const ORPHAN_REPAIR_DELAY_MS = 20_000;

/** Notes the Recommended panel draws at most, links and meaning together. */
const RECOMMEND_LIMIT = 20;

export default class SchreibstubePlugin extends Plugin {
  override settings: SchreibstubeSettings = DEFAULT_SETTINGS;
  private logger: Logger = createLogger(() => this.settings.debugLogging);
  private currentView: MarkdownView | null = null;
  /** Set first thing in `onunload`, so a frame or a callback that was already
   *  queued when the plugin went away finds nothing left to draw on. */
  private unloaded = false;
  private viewportTopLine = 0;
  private headingIndex: HeadingEntry[] = [];
  private lastIndexedContent = "";
  private ancestorStack: HeadingEntry[] = [];
  private lastRenderSignature = "";
  private overlayCoordinator = new OverlayCoordinator();
  private refreshScheduler: RefreshScheduler | null = null;
  private linkMode: LinkModeController | null = null;
  private llm: LlmCommands | null = null;
  private properties: PropertyController | null = null;
  private proofread: ProofreadController | null = null;
  private explorer: ExplorerController | null = null;
  private sections: PaneSectionsController | null = null;
  private recommendedFooter: RecommendedFooter | null = null;
  /** Search by meaning; read by the settings tab and the Explorer filter. */
  semantic: SemanticEngine | null = null;
  /** Search by meaning for other plugins; Pythia reaches it through the plugin registry. */
  api: SchreibstubeSemanticApi | null = null;
  /** Guards against firing twice inside one scheduled minute. */
  private lastPollMinute = -1;
  /** Sync records dropped here since the data file was last written, so the
   *  copy still in the file does not bring them back. */
  private droppedSyncRecords = new Map<string, number>();
  /** One save at a time: each reads the file before writing it, and two
   *  interleaved would each merge against what the other is about to replace. */
  private saveChain: Promise<void> = Promise.resolve();
  private mail: MailCommands | null = null;
  private publish: PublishCommands | null = null;
  private print: PrintCommands | null = null;
  private reminders: ReminderCommands | null = null;
  private notes: NoteCommands | null = null;
  private pdf: PdfCommands | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    // Before anything builds a string: commands are named once, at registration.
    setLanguage(this.settings.language);
    // Before the ribbon, the pane's tab or any row asks for it by name.
    registerSchreibstubeIcon();
    this.logger.debug("Loading Schreibstube.");

    this.refreshScheduler = new RefreshScheduler(
      (callback) => window.requestAnimationFrame(callback),
      ({ viewportTopLine, options }) => this.refreshForActiveView(viewportTopLine, options)
    );

    this.linkMode = new LinkModeController(this.app, this.logger);
    this.llm = new LlmCommands(this.app, () => this.settings, this.logger);
    this.properties = new PropertyController(
      this.app,
      () => this.settings,
      async (patch) => {
        this.settings = normalizeSettings({ ...this.settings, ...patch });
        await this.saveSettings();
      },
      this.logger
    );
    this.startProperties(this.properties);
    this.mail = new MailCommands(this.app, () => this.settings, this.logger);
    this.publish = new PublishCommands(
      this.app,
      () => this.settings,
      async (patch) => {
        this.settings = normalizeSettings({ ...this.settings, ...patch });
        await this.saveSettings();
      },
      this.logger
    );
    this.print = new PrintCommands(
      this.app,
      () => this.settings,
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
      this.manifest.version,
      this.logger,
      async () => {
        this.settings = normalizeSettings({ ...this.settings, printEnabled: true });
        await this.saveSettings();
      }
    );
    this.reminders = new ReminderCommands(this.app, () => this.settings, this.logger);
    this.notes = new NoteCommands(this.app, this.logger);
    // The reader is reached for only when the command runs. Obsidian's pdf.js
    // is fetched on that first call, and every vault that never summarises a
    // PDF pays nothing for the feature but the bytes of this line.
    this.pdf = new PdfCommands(this.app, this.logger, (data) =>
      import("./pdf/pdf-reader").then((module) => module.readPdfText(data))
    );
    this.proofread = new ProofreadController(this.app, () => this.settings, this.logger, {
      get: (path) => this.settings.syncState[path],
      set: async (path, record) => {
        this.settings.syncState = { ...this.settings.syncState, [path]: record };
        await this.saveSettings();
      },
      setMany: async (records) => {
        this.settings.syncState = { ...this.settings.syncState, ...records };
        await this.saveSettings();
        // A source that changed belongs in the recent lists, and the records
        // are written to the data file, where no vault event reaches the pane.
        this.sections?.invalidateLatest();
      },
      forget: async (path) => {
        const { [path]: _removed, ...rest } = this.settings.syncState;
        this.settings.syncState = rest;
        this.droppedSyncRecords.set(path, Date.now());
        await this.saveSettings();
      },
      all: () => this.settings.syncState,
      update: async (transform) => {
        const next = transform(this.settings.syncState);
        if (next === null) return;
        const now = Date.now();
        for (const path of Object.keys(this.settings.syncState)) {
          if (next[path] === undefined) this.droppedSyncRecords.set(path, now);
        }
        this.settings.syncState = next;
        await this.saveSettings();
        this.sections?.invalidateLatest();
      }
    });

    this.semantic = new SemanticEngine(this, () => this.settings, this.logger);
    this.semantic.start();
    this.api = createSemanticApi({
      engine: this.semantic,
      logger: this.logger,
      vaultHit: (path) => this.vaultHit(path)
    });

    this.explorer = new ExplorerController(
      this.app,
      () => this.settings,
      {
        checkFile: async (file) => this.requireProofread().checkFile(file),
        checkFolder: async (path) => this.requireProofread().checkFolder(path),
        forget: async (path) => this.requireProofread().forgetSyncRecord(path)
      },
      this.logger,
      this.explorerStateFile()
    );
    // The pane's menu names a file from what is inside it; the AI commands are
    // what can do that, and they were built a moment ago.
    this.explorer.useNamer((file) => this.requireLlm().proposeName(file));
    this.explorer.useDescriber((file) => this.requireLlm().describeImage(file));
    this.explorer.useTagOpener((tag) => this.activateTagNotes(tag));
    // From a note's menu: the reader named the note, so the panel stays on it.
    this.explorer.useRelatedOpener((path) => this.activateRelatedNotes(path, false));
    // From a folder's menu: the grid then keeps up with the folder pressed in the pane.
    this.explorer.useFolderTilesOpener((folder, following) =>
      this.activateFolderTiles(folder, following)
    );
    await this.explorer.start();
    this.recommendedFooter = new RecommendedFooter(
      this,
      () => this.recommendedHost(),
      () => this.settings.recommendedPlacement
    );
    this.recommendedFooter.start();
    // A picture renamed outside Obsidian, or deleted while it was closed, left
    // its description behind; the ones that only moved are found by content.
    this.app.workspace.onLayoutReady(() => {
      const repair = window.setTimeout(() => {
        void this.explorer?.repairOrphans().catch((error: unknown) => {
          this.logger.warn("Could not match orphaned picture descriptions:", error);
        });
      }, ORPHAN_REPAIR_DELAY_MS);
      this.register(() => window.clearTimeout(repair));
    });

    this.sections = new PaneSectionsController(
      this.app,
      () => this.settings,
      this.logger,
      (path) => this.revealInExplorerPanes(path)
    );
    await this.sections.start();

    this.registerView(REVIEW_VIEW_TYPE, (leaf) => this.createReviewView(leaf));
    this.registerView(EXPLORER_VIEW_TYPE, (leaf) => this.createExplorerView(leaf));
    this.registerView(TAG_NOTES_VIEW_TYPE, (leaf) => this.createTagNotesView(leaf));
    this.registerView(RELATED_NOTES_VIEW_TYPE, (leaf) => this.createRelatedNotesView(leaf));
    this.registerView(FOLDER_TILES_VIEW_TYPE, (leaf) => this.createFolderTilesView(leaf));
    this.registerExplorerEvents();
    this.registerEditorExtension(
      createGlossaryUnderlineExtension({
        getSettings: () => this.settings,
        getMatcher: () => this.proofread?.activeMatcher() ?? compileGlossaries([])
      })
    );
    // `:folder:` in a note: the picker while one is typed, the glyph in Live
    // Preview, and the glyph in Reading view. One setting switches all three.
    const iconShortcodes = (): boolean => this.settings.iconShortcodes;
    this.registerEditorSuggest(new IconShortcodeSuggest(this.app, iconShortcodes));
    this.registerEditorExtension(createIconShortcodeExtension(iconShortcodes));
    registerIconShortcodePostProcessor(this, iconShortcodes);
    this.registerProofreadEvents();
    this.startPollTicker();

    bootstrapSchreibstubeRuntime(this, {
      onViewportFromEditor: (viewportTopLine) => {
        this.queueRefreshForActiveView(viewportTopLine);
      },
      onViewportFromReading: ({ viewportTopLine, scrollTop }) => {
        this.queueRefreshForActiveView(viewportTopLine, { readingScrollTop: scrollTop });
      },
      getSettings: () => this.settings,
      onActiveLeafChange: () => {
        this.requestOverlayRefresh();
        void this.proofread?.syncActiveFile();
      }
    });

    this.linkMode.start(this.addStatusBarItem());
    this.registerDomEvent(
      document,
      "click",
      (e: MouseEvent) => {
        void this.linkMode?.handleDocumentClick(e);
      },
      true
    );

    this.registerCommands();

    // The same action as the command, where a right-click or a long press
    // lands. Obsidian puts the cursor on the clicked line before it asks for
    // the menu, so the task under the cursor is the task under the pointer.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (!(view instanceof MarkdownView) || !view.file) return;
        if (!commandAvailable("send-reminder", this.commandContext())) return;
        this.reminders?.addMenuItem(menu, editor, view.file);
      })
    );
    // Selected lines into a table. The plain conversion is offered only when
    // it would work, since the menu is built for this very selection; the AI
    // one whenever several lines are selected, and says what it needs if the
    // key is missing.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const range = selectedLineRange(editor);
        if (!range) return;

        const table = localTable(editor, range);
        if (table) {
          menu.addItem((item) =>
            item
              .setTitle(t().ai.tableMenu)
              .setIcon("table")
              .setSection("selection")
              .onClick(() => insertTable(editor, range, table))
          );
        }
        menu.addItem((item) =>
          item
            .setTitle(t().ai.tableMenuAi)
            .setIcon("sparkles")
            .setSection("selection")
            .onClick(() => {
              void this.llm?.tableFromSelection(editor);
            })
        );
      })
    );
    // The link a reminder carries, obsidian://schreibstube?task=<id>, and the
    // callback the status Shortcut answers through, obsidian://schreibstube?done=1.
    this.registerObsidianProtocolHandler(TASK_PROTOCOL_ACTION, (params) => {
      void this.reminders?.handleProtocol(params);
    });

    // The file pane is the plugin's main surface and everything else it offers
    // is a command. Without a ribbon icon there is nothing to find: enabling
    // the plugin changes nothing anyone can see until they open the palette
    // and already know what to search for.
    this.addRibbonIcon(EXPLORER_RIBBON_ICON, t().commands.openExplorer, () => {
      void this.activateExplorerPane();
    });
    this.addSettingTab(new SchreibstubeSettingTab(this.app, this));
    this.requestOverlayRefresh();
  }

  /**
   * Property icons and menu entries, in this window and every one popped out
   * later. Capture phase: the press has to be seen before Obsidian's own
   * handler opens the menu, whatever that handler does with the event.
   */
  private startProperties(properties: PropertyController): void {
    const register = (doc: Document, type: string, handler: (event: Event) => void) => {
      this.registerDomEvent(doc, type as keyof DocumentEventMap, handler, { capture: true });
    };
    properties.attach(window, register);
    this.registerEvent(
      this.app.workspace.on("window-open", (_workspaceWindow, win) =>
        properties.attach(win, register)
      )
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (_workspaceWindow, win) => properties.detach(win))
    );
    properties.start();
  }

  override onunload(): void {
    this.unloaded = true;
    uninstallIconFont();
    this.linkMode?.stop();
    this.properties?.stop();
    this.print?.stop();
    this.proofread?.stop();
    void this.explorer?.stop();
    this.sections?.stop();
    this.semantic?.dispose();
    // A caller holding the object finds it answering nothing; one asking the
    // registry again finds no API at all.
    this.api = null;
    this.clearOverlay();
  }

  /** A vault path as the API reports it: a description note as its picture. */
  private vaultHit(path: string): { kind: "note" | "image"; id: string; title: string } | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const image = this.explorer?.imageDescribedBy(path) ?? null;
    const picture = image === null ? null : this.app.vault.getAbstractFileByPath(image);
    if (picture instanceof TFile)
      return { kind: "image", id: picture.path, title: picture.basename };
    const title = this.app.metadataCache.getFileCache(file)?.frontmatter?.title;
    return { kind: "note", id: path, title: typeof title === "string" ? title : file.basename };
  }

  /** Match what can be matched, then list what could not, to open one. */
  private async showOrphanedDescriptions(): Promise<void> {
    const explorer = this.explorer;
    if (!explorer) return;
    const { repaired, remaining } = await explorer.repairOrphans();
    if (repaired > 0) new Notice(t().common.notice(t().explorer.orphans.repaired(repaired)));
    if (remaining.length === 0) {
      if (repaired === 0) new Notice(t().common.notice(t().explorer.orphans.none));
      return;
    }
    new OrphanListModal(this.app, remaining, (path) => {
      void this.app.workspace.openLinkText(path, "", false);
    }).open();
  }

  /** Open the review sidebar, reusing the existing leaf if it is already open. */
  async activateReviewPanel(): Promise<void> {
    const [existing] = this.app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE);
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice(t().common.notice(t().common.sidebarMissing(t().proofread.panelTitle)));
      return;
    }
    await leaf.setViewState({ type: REVIEW_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Open the file pane, reusing the existing leaf if it is already open. */
  async activateExplorerPane(): Promise<void> {
    const [existing] = this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE);
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      // Already open, so nothing redraws on its own: it has to be told to go
      // to whatever is being edited now.
      this.revealActiveFileInExplorerPanes();
      return;
    }

    const leaf = this.app.workspace.getLeftLeaf(false);
    if (!leaf) {
      new Notice(t().common.notice(t().common.sidebarMissing(t().explorer.title)));
      return;
    }
    await leaf.setViewState({ type: EXPLORER_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /**
   * List a tag's notes in the right sidebar.
   *
   * One leaf for every tag: pressing a second pinned tag changes what the
   * sidebar lists rather than opening another, which is what a person pressing
   * down a column of tags is doing.
   */
  async activateTagNotes(tag: string): Promise<void> {
    const [existing] = this.app.workspace.getLeavesOfType(TAG_NOTES_VIEW_TYPE);
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice(t().common.notice(t().common.sidebarMissing(t().explorer.tags.viewTitle)));
      return;
    }
    await leaf.setViewState({ type: TAG_NOTES_VIEW_TYPE, state: { tag }, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /**
   * List a note's related notes in the right sidebar.
   *
   * One leaf, like the tag list: the panel follows whatever note is open, so a
   * second one would only ever say the same thing twice. Asking for a
   * particular note from its menu pins the panel to that note instead, which
   * is what `following` carries — the panel cannot tell from the path alone
   * whether it was handed the note in front of the reader or the one they
   * pointed at.
   */
  async activateRelatedNotes(path: string, following: boolean): Promise<void> {
    const [existing] = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice(t().common.notice(t().common.sidebarMissing(t().explorer.related.viewTitle)));
      return;
    }
    await leaf.setViewState({
      type: RELATED_NOTES_VIEW_TYPE,
      state: { path, following },
      active: true
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private createRelatedNotesView(leaf: WorkspaceLeaf): RelatedNotesView {
    const view = new RelatedNotesView(leaf);
    const host = this.recommendedHost();
    if (host) view.connect(host);
    return view;
  }

  /** What the Recommended panel asks, wherever it is drawn. */
  private recommendedHost(): RecommendedHost | null {
    const explorer = this.explorer;
    if (!explorer) return null;
    return {
      cards: (path) => explorer.relatedCards(path),
      recommend: (path) => this.recommend(path),
      titleOf: (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? (explorer.titleFor(file) ?? file.basename) : null;
      },
      open: async (path, where) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file) await explorer.open(file, where);
      },
      openConversation: (id) => {
        // Pythia opens it itself when it can; otherwise its deep link does.
        if (this.semantic?.conversations.open(id)) return;
        window.open(`obsidian://pythia?cmd=resume&id=${encodeURIComponent(id)}`);
      },
      showMenu: (path, event) => explorer.showMenuForPath(path, event)
    };
  }

  /**
   * The link graph and search by meaning together, for one note. Null when
   * search by meaning is off, so the panel keeps the graph's answer alone.
   */
  private async recommend(path: string): Promise<Recommendation | null> {
    const explorer = this.explorer;
    const engine = this.semantic;
    if (!explorer || !engine?.enabled()) return null;
    const found = await engine.relatedToNote(path, RECOMMEND_LIMIT);
    const graph = explorer.relatedCards(path);

    const meaning: { path: string }[] = [];
    const pictures: PictureCard[] = [];
    for (const hit of found.notes) {
      // A description note stands for its picture, here as in the Explorer.
      const image = explorer.imageDescribedBy(hit.id);
      const picture = image === null ? null : this.app.vault.getAbstractFileByPath(image);
      if (picture instanceof TFile) {
        if (!pictures.some((p) => p.path === picture.path)) {
          pictures.push({
            path: picture.path,
            title: picture.basename,
            src: this.app.vault.getResourcePath(picture)
          });
        }
        continue;
      }
      const note = this.app.vault.getAbstractFileByPath(hit.id);
      if (note instanceof TFile && !explorer.isTrashed(note.path))
        meaning.push({ path: note.path });
    }

    const cards = new Map(graph.map((card) => [card.path, card]));
    const notes: RelatedCard[] = [];
    for (const entry of recommendNotes(graph, meaning, RECOMMEND_LIMIT)) {
      const known = cards.get(entry.path);
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) continue;
      notes.push({
        path: entry.path,
        title: known?.title ?? explorer.titleFor(file) ?? file.basename,
        folder: file.parent && !file.parent.isRoot() ? file.parent.path : "",
        reasons: entry.reasons
      });
    }
    const conversations = found.conversations.map((c) => ({
      id: c.id,
      title: engine.conversations.titleOf(c.id)
    }));
    return { notes, pictures, conversations };
  }

  /**
   * A folder's pictures as tiles, in a tab of the main area.
   *
   * One tab of the kind, like the sidebar panels: a following grid is one
   * answer, and two of them would say it twice. `getLeaf("tab")` always has
   * a leaf to give, so there is no sidebar to be missing here. Made active
   * because a person chose the menu entry; a later folder press updates the
   * tab through the view's own listener and never comes back through here.
   */
  async activateFolderTiles(folder: string, following: boolean): Promise<void> {
    const [existing] = this.app.workspace.getLeavesOfType(FOLDER_TILES_VIEW_TYPE);
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: FOLDER_TILES_VIEW_TYPE,
      state: { folder, following },
      active: true
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private createFolderTilesView(leaf: WorkspaceLeaf): FolderTilesView {
    const view = new FolderTilesView(leaf);
    const explorer = this.explorer;
    if (explorer) {
      view.connect({
        tiles: (folder) => explorer.folderTiles(folder),
        resourceUrl: (path) => explorer.resourceUrl(path),
        open: async (path, into) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) return;
          if (into === "tab") await explorer.open(file, "tab");
          else await into.openFile(file);
        },
        showMenu: (path, at) => explorer.showMenuForPath(path, at),
        onFolderChosen: (listener) => explorer.onFolderChosen(listener)
      });
    }
    return view;
  }

  private createTagNotesView(leaf: WorkspaceLeaf): TagNotesView {
    const view = new TagNotesView(leaf);
    const explorer = this.explorer;
    if (explorer) {
      view.connect({
        cards: (tag) => explorer.tagCards(tag),
        open: async (path, where) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file) await explorer.open(file, where);
        },
        showMenu: (path, event) => explorer.showMenuForPath(path, event)
      });
    }
    return view;
  }

  private createExplorerView(leaf: WorkspaceLeaf): ExplorerPaneView {
    const view = new ExplorerPaneView(leaf);
    if (this.explorer && this.sections) {
      view.connect({
        explorer: this.explorer,
        sections: this.sections,
        settings: () => this.settings,
        meaning: async (text, limit) => (await this.semantic?.search(text, limit)) ?? []
      });
    }
    return view;
  }

  private async copyBookmarkPath(folderPath: string): Promise<void> {
    const url = vaultUrlFor(folderPath);

    try {
      await navigator.clipboard.writeText(url);
      new Notice(t().common.notice(t().explorer.bookmarks.copied(folderPath)));
    } catch (error) {
      this.logger.warn(`Could not copy ${url} to the clipboard:`, error);
      new Notice(t().common.notice(t().explorer.bookmarks.copyFailed));
    }
  }

  /** Put the file being edited on screen in every open pane. */
  private revealActiveFileInExplorerPanes(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof ExplorerPaneView) view.revealActiveFile();
    }
  }

  /** Show a folder in every open file pane. What a `vault://` bookmark does. */
  private revealInExplorerPanes(path: string, mayOpen = true): void {
    const leaves = this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE);
    const [first] = leaves;
    if (!first) {
      // One attempt only. `activateExplorerPane` reports and returns when the
      // workspace has no left sidebar to put the pane in, and retrying on that
      // would call straight back into here for the rest of the session.
      if (!mayOpen) return;
      void this.activateExplorerPane().then(() => this.revealInExplorerPanes(path, false));
      return;
    }

    for (const leaf of leaves) {
      if (leaf.view instanceof ExplorerPaneView) leaf.view.revealFolder(path);
    }
    void this.app.workspace.revealLeaf(first);
  }

  /**
   * The state file, next to the plugin's own data file.
   *
   * Separate from `data.json` on purpose: that one is rewritten whole on every
   * save, so a device holding a stale copy would clobber another device's
   * icons along with everything else. See services/explorer-store.
   */
  private explorerStateFile(): ExplorerFileStore {
    const adapter = this.app.vault.adapter;
    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const path = `${dir}/${EXPLORER_STATE_FILE}`;

    return {
      read: async () => ((await adapter.exists(path)) ? adapter.read(path) : null),
      write: async (text) => adapter.write(path, text),
      mtime: async () => (await adapter.stat(path))?.mtime ?? null
    };
  }

  private registerExplorerEvents(): void {
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => this.explorer?.handleRename(file, oldPath))
    );
    this.registerEvent(this.app.vault.on("delete", (file) => this.explorer?.handleDelete(file)));
    // Obsidian replays a create for every file while the vault indexes, so this
    // one waits: before layout is ready there is nothing a create can tell us
    // that the state file does not already say.
    this.app.workspace.onLayoutReady(() => {
      // A plugin disabled while the vault was still indexing would otherwise
      // register a listener on a component that has already been unloaded,
      // and nothing would ever take it off again.
      if (this.unloaded) return;
      this.registerEvent(this.app.vault.on("create", (file) => this.explorer?.handleCreate(file)));
    });

    // The two lists above the tree are a snapshot of the vault, so any change to
    // it makes them stale. The bookmarks file costs a re-read; everything else
    // only marks the recent-notes lists for recomputing on the next draw.
    const touched = (file: TAbstractFile): void => {
      if (this.sections?.isBookmarksFile(file.path)) void this.sections.reload();
      this.sections?.invalidateLatest();
    };

    this.registerEvent(this.app.vault.on("create", touched));
    this.registerEvent(this.app.vault.on("delete", touched));
    this.registerEvent(this.app.vault.on("modify", touched));

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const sections = this.sections;
        if (!sections) return;
        if (sections.isBookmarksFile(file.path) || sections.isBookmarksFile(oldPath)) {
          void sections.reload();
        }
        sections.invalidateLatest();
      })
    );

    // A folder is bookmarked by pasting its `vault://` URL into the bookmarks
    // file, so the path has to be obtainable without typing it out by hand.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFolder)) return;
        menu.addItem((item) =>
          item
            .setTitle(t().explorer.bookmarks.copyPath)
            .setIcon("link")
            .setSection("info")
            .onClick(() => void this.copyBookmarkPath(file.path))
        );
      })
    );

    // The bookmarks file may not be indexed yet when the plugin loads, which is
    // the normal case on a phone waiting for iCloud. Read it again once the
    // vault says it is ready.
    this.app.workspace.onLayoutReady(() => {
      void this.sections?.reload();
    });

    // A sync client drops a new state file in without telling anyone, so the
    // pane looks for one while it is on screen. Closed panes cost nothing.
    this.registerInterval(
      window.setInterval(() => {
        if (this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE).length === 0) return;
        void this.explorer?.checkForExternalChange();
      }, EXTERNAL_CHECK_MS)
    );
  }

  private requireProofread(): ProofreadController {
    if (!this.proofread) throw new Error("Schreibstube: the proofread controller is not ready.");
    return this.proofread;
  }

  private requireLlm(): LlmCommands {
    if (!this.llm) throw new Error("Schreibstube: the AI commands are not ready.");
    return this.llm;
  }

  private createReviewView(leaf: WorkspaceLeaf): ReviewPanelView {
    const view = new ReviewPanelView(leaf);
    const controller = this.proofread;
    if (controller) {
      view.setHandlers(controller.handlers());
      // Registered on the view, so closing the panel unsubscribes it. Hanging
      // the listener off the plugin instead would keep pushing state into a
      // detached view for the rest of the session.
      view.register(controller.onStateChange((state) => view.updateReviewState(state)));
      void controller.syncActiveFile();
    }
    return view;
  }

  /**
   * Drive the cron schedule.
   *
   * The ticker runs more often than once a minute so a drifting tick cannot
   * step over a scheduled minute; `shouldFire` collapses the repeats back down
   * to one fire per named minute.
   */
  private startPollTicker(): void {
    this.registerInterval(
      window.setInterval(() => {
        this.handlePollTick(new Date());
      }, POLL_TICK_MS)
    );

    // A schedule that came due while Obsidian was closed would otherwise never
    // run, which would make a daily poll useless on a machine that is not
    // always open. One catch-up on load, shortly after startup so it never
    // competes with opening the vault.
    const catchUp = window.setTimeout(() => {
      void this.catchUpPoll();
    }, POLL_CATCHUP_DELAY_MS);
    this.register(() => window.clearTimeout(catchUp));
  }

  private handlePollTick(now: Date): void {
    // The report file an automation writes for Reminders rides on the same
    // tick: one stat of one file, and a read only when it has changed.
    void this.reminders?.pollReportFile();

    const schedule = this.activePollSchedule();
    if (!schedule) return;
    if (!shouldFire(schedule, now, this.lastPollMinute)) return;

    this.lastPollMinute = minuteOf(now);
    void this.runPoll();
  }

  private async catchUpPoll(): Promise<void> {
    const schedule = this.activePollSchedule();
    if (!schedule) return;

    const due = previousRun(schedule, new Date());
    if (!due || this.settings.syncLastPollAt >= due.getTime()) return;

    this.logger.debug("Catching up a poll missed while Obsidian was closed.");
    await this.runPoll();
  }

  /** The parsed schedule, or null when the poll is off or the expression is
   *  unusable. An invalid expression silently does nothing here; the settings
   *  tab is where it is reported. */
  private activePollSchedule() {
    if (!this.settings.syncEnabled || !this.settings.syncPollEnabled) return null;
    const parsed = parseCron(this.settings.syncPollCron);
    return parsed.ok ? parsed.schedule : null;
  }

  private async runPoll(): Promise<void> {
    const summary = await this.proofread?.pollAllSources("schedule");
    if (!summary || summary.skipped) return;

    // Only a poll that ran counts as the last one: a daily schedule that met
    // a check already in progress used to be recorded as done, and the
    // catch-up on the next start then saw nothing owed.
    this.settings.syncLastPollAt = Date.now();
    await this.saveSettings();

    if (summary.withChanges > 0) {
      new Notice(t().common.notice(t().sync.withUpdates(summary.withChanges)));
    }
  }

  private registerProofreadEvents(): void {
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        this.proofread?.notifyEditorChanged();
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          void this.proofread?.invalidateGlossary(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        void this.proofread?.syncActiveFile();
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          void this.proofread?.handleNoteRenamed(oldPath, file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          void this.proofread?.handleNoteDeleted(file.path);
        }
      })
    );

    // A binding removed or changed on another device reaches this one only as
    // a note whose frontmatter now says so. Asked only of notes that have a
    // record, so an ordinary save costs a lookup and nothing more.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (this.settings.syncState[file.path] !== undefined) {
          void this.proofread?.reconcileSyncRecords([file.path]);
        }
      })
    );
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = normalizeSettings(loaded);
    if (holdsRetiredSettings(loaded)) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    const run = this.saveChain.then(() => this.writeSettings());
    this.saveChain = run.catch(() => undefined);
    await run;
    // A changed bookmarks path, or Document sync turned on or off, only matters
    // once the pane has been told; nothing else watches the settings object.
    void this.sections?.reloadIfPathChanged();
    this.sections?.invalidateLatest();
    this.recommendedFooter?.sync();
  }

  /**
   * Write the settings, with the sync records merged into what the file holds.
   *
   * Everything else is this device's to say, and is written as it stands. The
   * sync records are not: another device may have checked a note since this
   * one last read the file, and writing this device's copy over it made every
   * device forget what the others had fetched and accepted.
   */
  private async writeSettings(): Promise<void> {
    const disk = await this.readDiskSyncState();
    if (disk !== null) {
      this.settings.syncState = mergeSyncState({
        local: this.settings.syncState,
        disk,
        dropped: this.droppedSyncRecords
      });
    }
    await this.saveData(this.settings);
    this.droppedSyncRecords.clear();
  }

  /** The sync records as the data file holds them, or null when it cannot be
   *  read — in which case this device's copy is written as before. */
  private async readDiskSyncState(): Promise<Record<string, SyncRecord> | null> {
    try {
      return normalizeSettings(await this.loadData()).syncState;
    } catch (error) {
      this.logger.debug("Could not read the data file to merge sync records:", error);
      return null;
    }
  }

  /**
   * Another device's save has arrived.
   *
   * Only the sync records are taken from it, merged note by note: they are what
   * a device acts on without being asked, and a stale copy reported updates the
   * note already held. Settings a person changed keep the rule they always had.
   */
  override async onExternalSettingsChange(): Promise<void> {
    const disk = await this.readDiskSyncState();
    if (disk === null) return;

    const merged = mergeSyncState({
      local: this.settings.syncState,
      disk,
      dropped: this.droppedSyncRecords
    });
    if (sameSyncState(merged, this.settings.syncState)) return;

    this.settings.syncState = merged;
    this.sections?.invalidateLatest();
  }

  requestOverlayRefresh(): void {
    this.queueRefreshForActiveView();
  }

  async updateDimOpacity(dimOpacity: number): Promise<void> {
    this.settings = normalizeSettings({
      ...this.settings,
      focusDimOpacity: dimOpacity
    });
    await this.saveSettings();
    this.notifyFocusSettingsChanged();
  }

  /**
   * The typesetter, as the settings tab needs to talk about it.
   *
   * Three narrow methods rather than handing the tab the print controller: the
   * tab asks whether the download has happened, starts it, or undoes it, and
   * has no business with anything else printing can do.
   */
  printRuntimeInstalled(): Promise<boolean> {
    return this.print?.runtimeInstalled() ?? Promise.resolve(false);
  }

  async downloadPrintRuntime(): Promise<void> {
    await this.print?.fetchRuntime();
  }

  async removePrintRuntime(): Promise<void> {
    await this.print?.removeRuntime();
  }

  /** The vault's own templates, for the tab to offer as the default. */
  printTemplates(): PrintTemplate[] {
    return this.print?.templates() ?? [];
  }

  /** Adding a template is set up once, so it is a button on the print tab. */
  async addPrintTemplate(): Promise<void> {
    await this.print?.addTemplate();
  }

  /** Opening the published site is occasional, so it is a button on the tab. */
  async openPublishedSite(): Promise<void> {
    await this.publish?.openSite();
  }

  /**
   * What is on screen, as the availability rules ask about it.
   *
   * Built fresh for every check: Obsidian asks a command whether it applies
   * each time the palette opens, which is exactly when the answer can have
   * changed.
   */
  private commandContext(): CommandContext {
    const file = this.app.workspace.getActiveFile();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);

    return {
      markdown: file?.extension === "md",
      image: file !== null && getImageMimeType(file.extension) !== null,
      selection: (view?.editor.getSelection().trim().length ?? 0) > 0,
      bound:
        file !== null && hasSourceBinding(this.app.metadataCache.getFileCache(file)?.frontmatter),
      explorerOpen: this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE).length > 0,
      task: view !== null && isTaskLine(view.editor.getLine(view.editor.getCursor().line)),
      apple: Platform.isMacOS || Platform.isIosApp,
      sentTask: view !== null && sentTaskIds(view.editor.getValue()).length > 0
    };
  }

  /**
   * A command that is only offered when it could do something.
   *
   * Obsidian calls the check twice: once to ask whether to list the command,
   * and again with `checking` false to run it. The condition is the same both
   * times, so a command cannot be run from a state it was hidden in.
   */
  private addGatedCommand(id: string, name: string, gate: GatedCommand, run: () => void): void {
    this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        if (!commandAvailable(gate, this.commandContext())) return false;
        if (!checking) run();
        return true;
      }
    });
  }

  private registerCommands(): void {
    this.addCommand({
      id: "create-untitled-note",
      name: t().commands.newNote,
      callback: () => {
        void this.notes?.createUntitled();
      }
    });

    this.addCommand({
      id: "set-focus-sentence-mode",
      name: t().commands.focusSentence,
      callback: () => {
        void this.setFocusMode(toggledFocusMode(this.settings.focusMode, "sentence"));
      }
    });

    this.addCommand({
      id: "set-focus-paragraph-mode",
      name: t().commands.focusParagraph,
      callback: () => {
        void this.setFocusMode(toggledFocusMode(this.settings.focusMode, "paragraph"));
      }
    });

    this.addCommand({
      id: "insert-task-summary",
      name: t().commands.insertTaskSummary,
      editorCallback: (editor) => {
        this.insertTaskSummary(editor);
      }
    });

    this.addCommand({
      id: "insert-slideshow",
      name: t().commands.insertSlideshow,
      editorCallback: (editor) => {
        this.insertSlideshow(editor);
      }
    });

    this.addCommand({
      id: "insert-pdf-summary",
      name: t().commands.insertPdfSummary,
      editorCallback: (editor) => {
        void this.pdf?.insertSummary(editor);
      }
    });

    // One rename for whatever is open. The id is the note rename's, so a hotkey
    // bound to it keeps working and now renames a picture too.
    this.addGatedCommand("rename-from-content", t().commands.rename, "rename", () => {
      if (renameTarget(this.commandContext()) === "image") {
        void this.llm?.renameImageFromContent();
      } else {
        void this.llm?.renameFromContent();
      }
    });

    this.addGatedCommand("summarize-selection", t().commands.summarize, "summarize", () => {
      void this.llm?.summarizeSelection();
    });

    // Two commands, not one that falls back on its own: only the second sends
    // the note's text to the provider, and that should be a choice.
    this.addGatedCommand("table-from-selection", t().commands.table, "table", () => {
      const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
      if (editor) convertSelectionToTable(editor);
    });

    this.addGatedCommand("ai-table-from-selection", t().commands.tableAi, "table", () => {
      const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
      if (editor) void this.llm?.tableFromSelection(editor);
    });

    // Into the property field being typed in, or the note's text otherwise.
    this.addGatedCommand("insert-today", t().commands.insertToday, "insert-today", () => {
      this.properties?.insertToday();
    });

    this.addGatedCommand(
      "send-task-to-reminders",
      t().commands.sendToReminders,
      "send-reminder",
      () => {
        this.reminders?.sendTaskAtCursor();
      }
    );

    // The id is the one that asked about every note, which is still what it
    // does wherever the open note has no sent task.
    this.addGatedCommand("fetch-done-from-reminders", t().commands.reminders, "reminders", () => {
      if (remindersScope(this.commandContext()) === "note") {
        this.reminders?.checkActiveNote();
      } else {
        this.reminders?.checkEverything();
      }
    });

    this.addCommand({
      id: "open-explorer-pane",
      name: t().commands.openExplorer,
      icon: EXPLORER_RIBBON_ICON,
      callback: () => {
        void this.activateExplorerPane();
      }
    });

    // Obsidian's own collapse-all is a button on its explorer's header and
    // nothing else: no command, so no hotkey. This one is both.
    this.addGatedCommand(
      "collapse-explorer-folders",
      t().commands.collapseExplorer,
      "collapse-explorer",
      () => {
        for (const leaf of this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE)) {
          if (leaf.view instanceof ExplorerPaneView) leaf.view.collapseAll();
        }
      }
    );

    // ⌘Z inside the pane does the same; this is for a hotkey of one's own,
    // and for the palette after the notice offering it has gone.
    this.addGatedCommand(
      "explorer-undo",
      t().commands.explorerUndo,
      "collapse-explorer",
      () => void this.explorer?.undoLast()
    );

    this.addCommand({
      id: "explorer-orphaned-descriptions",
      name: t().commands.orphanedDescriptions,
      callback: () => void this.showOrphanedDescriptions()
    });

    // The folder of the note in front of you, as tiles — a route for the
    // palette and a hotkey, and for a phone where the pane may be shut.
    // Offered only when that folder has a picture of its own to show.
    this.addCommand({
      id: "folder-tiles",
      name: t().commands.folderTiles,
      checkCallback: (checking) => {
        const parent = this.app.workspace.getActiveFile()?.parent;
        if (!parent || !this.explorer?.folderHasImages(parent.path)) return false;
        if (!checking) void this.activateFolderTiles(parent.path, true);
        return true;
      }
    });

    this.addCommand({
      id: "pin-tag",
      name: t().commands.pinTag,
      callback: () => {
        this.explorer?.chooseTag();
      }
    });

    this.addGatedCommand("related-notes", t().commands.related, "related", () => {
      const file = this.app.workspace.getActiveFile();
      // From the palette: the note in front of the reader is only where the
      // panel starts, and it follows them from there.
      if (file) void this.activateRelatedNotes(file.path, true);
    });

    this.addCommand({
      id: "open-bookmark",
      name: t().commands.openBookmark,
      callback: () => {
        if (this.sections) new BookmarkQuickOpenModal(this.app, this.sections).open();
      }
    });

    this.addCommand({
      id: "open-review-panel",
      name: t().commands.openReview,
      callback: () => {
        void this.activateReviewPanel();
      }
    });

    this.addCommand({
      id: "proof-read-note",
      name: t().commands.proofread,
      editorCallback: () => {
        void this.activateReviewPanel().then(() => this.proofread?.handlers().onProofread());
      }
    });

    this.addCommand({
      id: "poll-all-sources",
      name: t().commands.syncAll,
      callback: () => {
        void this.proofread?.pollAllSources("manual").then(async (summary) => {
          if (!summary.skipped) {
            this.settings.syncLastPollAt = Date.now();
            await this.saveSettings();
          }
          new Notice(t().common.notice(describePollSummary(summary, { scope: "vault" })));
        });
      }
    });

    this.addGatedCommand("check-note-source", t().commands.syncNote, "check-source", () => {
      void this.activateReviewPanel().then(() => this.proofread?.handlers().onCheckSource());
    });

    this.addGatedCommand("send-note-as-email", t().commands.sendMail, "send-mail", () => {
      void this.mail?.sendNoteAsEmail();
    });

    this.addCommand({
      id: "query-mailbox",
      name: t().commands.queryMailbox,
      callback: () => {
        void this.mail?.queryMailbox();
      }
    });

    this.addGatedCommand("fetch-replies", t().commands.fetchReplies, "fetch-replies", () => {
      void this.mail?.fetchReplies();
    });

    this.addGatedCommand("print-note", t().commands.print, "print", () => {
      void this.print?.printActiveNote();
    });

    // The same print without the dialog, for a note that is printed as it is
    // again and again.
    this.addGatedCommand("print-note-quick", t().commands.printQuick, "print", () => {
      void this.print?.printActiveNoteQuickly();
    });

    this.addCommand({
      id: "publish-folder",
      name: t().commands.publish,
      callback: () => {
        void this.publish?.publish();
      }
    });

    this.addCommand({
      id: "switch-link-side",
      name: t().commands.linksSwitch,
      callback: () => {
        this.linkMode?.cycleMode();
      }
    });
  }

  /**
   * One ribbon per note. A second block would count the same tasks twice on
   * screen, so the command says so rather than adding it.
   */
  private insertTaskSummary(editor: Editor): void {
    if (hasTaskSummaryBlock(editor.getValue())) {
      new Notice(t().common.notice(t().tasks.alreadyPresent));
      return;
    }

    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const insertion = buildTaskSummaryInsertion(line.slice(0, cursor.ch), line.slice(cursor.ch));
    editor.replaceRange(insertion, cursor);

    // Below the block, on the line the writer was heading for anyway; inside
    // it the cursor would show the raw fence instead of the ribbon.
    const insertedLines = insertion.split("\n").length - 1;
    editor.setCursor({ line: cursor.line + insertedLines, ch: 0 });
  }

  /**
   * Drops an image-slideshow block at the cursor with two placeholder image
   * lines, so the writer sees the shape and edits the paths in place. Unlike
   * the task ribbon, a note may hold several slideshows, so nothing is checked.
   */
  private insertSlideshow(editor: Editor): void {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const insertion = buildSlideshowInsertion(line.slice(0, cursor.ch), line.slice(cursor.ch));
    editor.replaceRange(insertion, cursor);
    const insertedLines = insertion.split("\n").length - 1;
    editor.setCursor({ line: cursor.line + insertedLines, ch: 0 });
  }

  private async setFocusMode(mode: FocusMode): Promise<void> {
    this.settings = normalizeSettings({
      ...this.settings,
      focusMode: mode
    });
    await this.saveSettings();
    this.notifyFocusSettingsChanged();
  }

  private notifyFocusSettingsChanged(): void {
    window.dispatchEvent(new Event("schreibstube-focus-settings-changed"));
  }

  private queueRefreshForActiveView(viewportTopLine?: number, options?: RefreshOptions): void {
    if (!this.refreshScheduler) {
      this.refreshForActiveView(viewportTopLine, options);
      return;
    }
    this.refreshScheduler.enqueue(viewportTopLine, options);
  }

  private refreshForActiveView(viewportTopLine?: number, options?: RefreshOptions): void {
    // A scroll queues a frame; disabling the plugin does not cancel it. The
    // frame used to arrive after `onunload` had cleared the overlay and draw a
    // fresh one into a live view, with no owner left to take it down.
    if (this.unloaded || !this.settings.overlayEnabled) {
      this.clearOverlay();
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.clearOverlay();
      return;
    }

    const didViewChange = this.currentView !== view;
    if (didViewChange) {
      this.currentView = view;
      this.viewportTopLine = 0;
      this.lastRenderSignature = "";
    }

    if (viewportTopLine !== undefined) {
      this.viewportTopLine = Math.max(0, viewportTopLine);
    }

    const content = view.editor.getValue();
    if (content !== this.lastIndexedContent) {
      this.headingIndex = buildHeadingIndex(content);
      this.lastIndexedContent = content;
    }

    let resolvedViewportTopLine = this.viewportTopLine;
    if (typeof options?.readingScrollTop === "number") {
      resolvedViewportTopLine = resolveViewportLineForReadingView(
        view,
        this.headingIndex,
        resolvedViewportTopLine,
        options.readingScrollTop
      );
      this.viewportTopLine = resolvedViewportTopLine;
    }

    this.ancestorStack = resolveAncestorStack(this.headingIndex, resolvedViewportTopLine);
    this.renderOverlay(view);
  }

  private renderOverlay(view: MarkdownView | null = this.currentView): void {
    if (!view) {
      this.clearOverlay();
      return;
    }

    const sig = this.ancestorStack.map((e) => `${e.level}:${e.lineNumber}:${e.text}`).join("|");
    if (sig === this.lastRenderSignature) return;

    const rendered = this.overlayCoordinator.renderForView(
      view,
      { ancestorStack: this.ancestorStack },
      (event) => this.handleOverlayRowEvent(event)
    );

    if (!rendered) {
      this.clearOverlay();
      return;
    }

    this.lastRenderSignature = sig;
  }

  private clearOverlay(): void {
    this.overlayCoordinator.clear();
    this.lastRenderSignature = "";
    this.currentView = null;
  }

  private handleOverlayRowEvent(event: OverlayRowEvent): void {
    this.navigateToLine(reduceOverlayRowEvent(event));
  }

  private navigateToLine(lineNumber: number): void {
    const view = this.currentView ?? this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const targetHeading = this.headingIndex.find((e) => e.lineNumber === lineNumber);
    if (
      targetHeading &&
      scrollReadingHeadingIntoView(view, this.headingIndex, targetHeading.lineNumber)
    ) {
      this.viewportTopLine = targetHeading.lineNumber;
      this.refreshForActiveView(this.viewportTopLine);
      return;
    }

    view.editor.setCursor(lineNumber, 0);
    view.editor.scrollIntoView(
      { from: { line: lineNumber, ch: 0 }, to: { line: lineNumber, ch: 0 } },
      true
    );
    this.viewportTopLine = lineNumber;
    this.queueRefreshForActiveView(this.viewportTopLine);
  }
}
