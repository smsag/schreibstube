import {
  type Command,
  type Editor,
  MarkdownView,
  Notice,
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
} from "./platform/reading-navigator";
import { RefreshScheduler, type RefreshOptions } from "./services/refresh-scheduler";
import { OverlayCoordinator } from "./platform/overlay-coordinator";
import { bootstrapSchreibstubeRuntime } from "./platform/plugin-bootstrap";
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
import { NoteCommands } from "./controllers/note-commands";
import { SumsController } from "./controllers/sums-controller";
import { registerTableFormulaPostProcessor } from "./processors/table-formulas";
import { PdfCommands } from "./controllers/pdf-commands";
import { LinkModeController } from "./controllers/link-mode-controller";
import { LlmCommands } from "./controllers/llm-commands";
import { PropertyController } from "./controllers/property-controller";
import { PropertySetController } from "./controllers/property-set-controller";
import { PropertyWidgetControls } from "./controllers/property-widget-controls";
import { PictureArticleLinker } from "./controllers/picture-articles";
import { BaseReadingFlags, isBaseFile } from "./controllers/base-reading-flags";
import { BasesReadingView } from "./controllers/bases-reading";
import { PassagesController } from "./controllers/passages";
import { commandIcon } from "./services/command-icons";
import { PASSAGES_VIEW_TYPE, PassagesView } from "./ui/passages-view";
import { PASSAGE_OPTION } from "./services/passages";
import { PictureEmbedActions } from "./controllers/picture-embed-actions";
import { TagSuggestController } from "./controllers/tag-suggest-controller";
import { TAG_NEIGHBOUR_REQUEST, type RecommendedEntry } from "./services/tag-suggestions";
import { DraftWidth } from "./controllers/draft-width";
import { NEW_DOC_ACTION } from "./services/new-note";
import { FolderDescriber } from "./controllers/folder-describer";
import {
  convertSelectionToTable,
  insertTable,
  localTable,
  selectedLineRange
} from "./controllers/table-insert";
import { ProofreadController } from "./controllers/proofread-controller";
import { createGlossaryUnderlineExtension } from "./processors/glossary-underline";
import { revealFlashExtension } from "./processors/reveal-flash";
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
  ExplorerController,
  FOREIGN_MENU_SOURCE
} from "./controllers/explorer-controller";
import type { ExplorerFileStore } from "./services/explorer-store";
import { SemanticEngine } from "./controllers/semantic/semantic-engine";
import { createSemanticApi } from "./controllers/semantic/semantic-api";
import { folderOf } from "./services/path-follow";
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_SIMILARITY_PRESET,
  embeddingModelConfig
} from "./services/semantic/embedding-models";
import {
  foldDescriptions,
  meaningOrder,
  recommendNotes,
  withAttached,
  type RelevanceFloors
} from "./services/semantic/recommend";
import { RecommendedFooter } from "./controllers/recommended-footer";
import type {
  EntryLink,
  Recommendation,
  RecommendedHost,
  RecommendedItem
} from "./ui/recommended-panel";
import { fileGlyph } from "./services/file-glyph";
import { obsidianFileUrl } from "./services/obsidian-url";
import { splitItemKey, type SchreibstubeSemanticApi } from "./services/semantic/semantic-api";
import { communityPluginInstalled, communityPluginName } from "./services/workspace-internals";
import { iconGlyph } from "./ui/icon-font";
import { showChoiceNotice } from "./ui/action-notice";
import { PaneSectionsController } from "./controllers/pane-sections";
import { BookmarkQuickOpenModal } from "./ui/bookmark-quick-open";
import { OrphanListModal } from "./ui/explorer-modals";
import { copyText } from "./ui/copy-text";
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
  private folderDescriberInstance: FolderDescriber | null = null;

  private propertySets: PropertySetController | null = null;
  private propertyControls: PropertyWidgetControls | null = null;
  private pictureActions: PictureEmbedActions | null = null;
  private pictureArticles: PictureArticleLinker | null = null;
  private baseReading: BaseReadingFlags | null = null;
  private tagSuggest: TagSuggestController | null = null;
  private readonly draftWidth = new DraftWidth(this.app);
  private proofread: ProofreadController | null = null;
  private explorer: ExplorerController | null = null;
  private sections: PaneSectionsController | null = null;
  private recommendedFooter: RecommendedFooter | null = null;
  semantic: SemanticEngine | null = null;
  api: SchreibstubeSemanticApi | null = null;
  /** Sources asked about this session, so a plugin re-registering is not asked twice. */
  private readonly askedSources = new Set<string>();

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
  private notes: NoteCommands | null = null;
  private pdf: PdfCommands | null = null;
  private sums: SumsController | null = null;

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
    this.propertySets = new PropertySetController(this.app, () => this.settings, this.logger);
    const propertySets = this.propertySets;
    this.properties.setAddSetHandler((file) => void propertySets.pick(file));
    const llm = this.llm;
    this.tagSuggest = new TagSuggestController(
      this.app,
      (path) => this.recommendedEntries(path),
      (content, vocabulary) => llm.suggestTags(content, vocabulary),
      this.logger
    );
    const tagSuggest = this.tagSuggest;
    this.propertyControls = new PropertyWidgetControls(this.app, [
      {
        className: "schreibstube-add-set",
        icon: "list-plus",
        label: () => t().properties.addSetButton,
        ariaLabel: () => t().properties.addSet,
        press: (file) => void propertySets.pick(file)
      },
      {
        className: "schreibstube-suggest-tags",
        icon: "tags",
        label: () => t().tagSuggest.button,
        ariaLabel: () => t().tagSuggest.buttonLabel,
        press: (file) => void tagSuggest.open(file),
        shown: () => this.settings.tagSuggestControl
      }
    ]);
    this.startProperties(this.properties, propertySets, this.propertyControls);
    // Before mail, publish and print: each resolves a note's formulas on the way out.
    this.sums = new SumsController(
      this.app,
      () => this.settings,
      async (rates) => {
        this.settings = normalizeSettings({ ...this.settings, sumsRates: rates });
        await this.saveSettings();
      },
      this.logger
    );
    this.mail = new MailCommands(
      this.app,
      () => this.settings,
      this.logger,
      (file, message) =>
        propertySets.offerSet(file, "schreibstube:mail", message, t().properties.mailFieldsAction)
    );
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
    // Rates fetched for a table on screen reach it only when it is drawn again.
    this.sums.useRedraw(() => {
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.getMode() === "preview") {
          view.previewMode.rerender(true);
        }
      }
    });
    this.mail.useFormulas(this.sums);
    this.publish.useFormulas(this.sums);
    this.print.useFormulas(this.sums);
    // The footer is made later in the load; by the time the command runs it is there.
    this.notes = new NoteCommands(
      this.app,
      this.logger,
      (file) => this.recommendedFooter?.holdBack(file) ?? (() => undefined),
      (leaf, file) => this.draftWidth.follow(leaf, file)
    );
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
        this.sections?.invalidateLatest();
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
        this.sections?.invalidateLatest();
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
      vaultHit: (path) => this.vaultHit(path),
      isIcon: (name) => iconGlyph(name) !== undefined,
      pluginPresent: (id) => communityPluginInstalled(this.app, id)
    });
    this.semantic.onConsentNeeded((id, source) => this.askSourceConsent(id, source.plural));

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
    this.explorer.useFolderDescriber((folder) => this.folderDescriber.describe(folder));
    this.explorer.useTagOpener((tag) => this.activateTagNotes(tag));
    // From a note's menu: the reader named the note, so the panel stays on it.
    this.explorer.useRelatedOpener((path) => this.activateRelatedNotes(path, false));
    // From a folder's menu: the grid then keeps up with the folder pressed in the pane.
    this.explorer.useFolderTilesOpener((folder, following) =>
      this.activateFolderTiles(folder, following)
    );
    await this.explorer.start();
    this.startPictureActions(this.explorer);
    this.startPictureArticles(this.explorer);
    this.startBasesReadingView();
    this.registerPassagesView();
    this.recommendedFooter = new RecommendedFooter(
      this,
      () => this.recommendedHost(),
      () => this.settings.recommendedPlacement
    );
    this.recommendedFooter.start();
    // A picture renamed outside Obsidian, or deleted while it was closed, left
    // its description behind; the ones that only moved are found by content.
    this.app.workspace.onLayoutReady(() => {
      // Layout may become ready after the plugin was disabled, and a timer
      // registered on an unloaded component is never cleared.
      if (this.unloaded) return;
      const repair = window.setTimeout(() => {
        if (this.unloaded) return;
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
    // Where "Show passage" landed, marked for a moment.
    this.registerEditorExtension(revealFlashExtension);
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
    // The total of the selected amounts, and a formula's result in Reading view.
    const sums = this.sums;
    sums.startStatusBar(this.addStatusBarItem());
    this.registerEditorExtension(sums.editorExtension());
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => sums.clearSelection()));
    this.register(() => sums.stop());
    registerTableFormulaPostProcessor(this, sums);

    this.registerDomEvent(
      document,
      "click",
      (e: MouseEvent) => {
        void this.linkMode?.handleDocumentClick(e);
      },
      true
    );

    this.registerCommands();
    this.registerNewDocLink();

    // Selected lines into a table. The plain conversion is offered only when
    // it would work, since the menu is built for this very selection; the AI
    // one whenever several lines are selected, and says what it needs if the
    // key is missing.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        this.sums?.addMenuItem(menu, editor);
        // Printing what is marked is where the marking is, as well as in the palette.
        if (editor.getSelection().trim() !== "") {
          menu.addItem((item) =>
            item
              .setTitle(t().commands.printSelection)
              .setIcon("printer")
              .setSection("selection")
              .onClick(() => {
                void this.print?.printActiveSelection();
              })
          );
        }
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
  /**
   * The description and star buttons on Obsidian's bar over a picture, in
   * every window. The description is the Explorer's to find and open, since
   * it already keeps which note describes which picture.
   */
  private startPictureActions(explorer: ExplorerController): void {
    const actions = new PictureEmbedActions(
      this.app,
      {
        descriptionNoteOf: (path) => explorer.descriptionNoteOf(path),
        describe: (picture) => this.requireLlm().describeImage(picture),
        describingEnabled: () => this.settings.imageDescriptionsEnabled,
        open: (note, where) => explorer.open(note, where)
      },
      this.logger
    );
    this.pictureActions = actions;
    const register = (doc: Document, type: string, handler: (event: Event) => void) => {
      this.registerDomEvent(doc, type as keyof DocumentEventMap, handler, { capture: true });
    };
    actions.attach(window, register);
    this.registerEvent(
      this.app.workspace.on("window-open", (_workspaceWindow, win) => actions.attach(win, register))
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (_workspaceWindow, win) => actions.detach(win))
    );
  }

  /**
   * Each description note names the notes its picture appears in, so a base
   * in any of Obsidian's layouts can show the article beside the picture. A
   * pass runs once the links have settled after a change, and once when the
   * vault has been read, which is also how existing descriptions get theirs.
   */
  private startPictureArticles(explorer: ExplorerController): void {
    const linker = new PictureArticleLinker(
      this.app,
      {
        describedPictures: () => explorer.describedPictures(),
        isDescriptionNote: (path) => explorer.isDescriptionNote(path),
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number)
      },
      this.logger
    );
    this.pictureArticles = linker;
    this.registerEvent(this.app.metadataCache.on("resolved", () => linker.schedule()));
    this.app.workspace.onLayoutReady(() => linker.schedule());
  }

  /**
   * Notes opened from a base open in Reading view when that base says so.
   * Presses are noted in every window, in the capture phase: a base's own
   * handlers see the press first otherwise, and may open the note before
   * the press has been seen at all. Each base's answer is read from its file
   * when the vault is ready and whenever the file changes, and set from the
   * base's file menu — in the file list and on its tab — or the command.
   */
  private startBasesReadingView(): void {
    const flags = new BaseReadingFlags(this.app, this.logger);
    this.baseReading = flags;
    this.app.workspace.onLayoutReady(() => void flags.scan());
    const reread = (file: TAbstractFile) => {
      if (isBaseFile(file)) void flags.read(file);
    };
    this.registerEvent(this.app.vault.on("modify", reread));
    this.registerEvent(this.app.vault.on("create", reread));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => flags.renamed(file, oldPath))
    );
    this.registerEvent(this.app.vault.on("delete", (file) => flags.deleted(file.path)));
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!isBaseFile(file)) return;
        menu.addItem((item) =>
          item
            .setTitle(t().bases.readingMenu)
            .setIcon("book-open")
            .setChecked(flags.reads(file))
            .onClick(() => void this.toggleBaseReading(file))
        );
      })
    );

    const reading = new BasesReadingView(this.app, flags, this.logger);
    const register = (doc: Document, type: string, handler: (event: Event) => void) => {
      this.registerDomEvent(doc, type as keyof DocumentEventMap, handler, { capture: true });
    };
    reading.attach(window, register);
    this.registerEvent(
      this.app.workspace.on("window-open", (_workspaceWindow, win) => reading.attach(win, register))
    );
    this.registerEvent(this.app.workspace.on("file-open", (file) => void reading.opened(file)));
  }

  /**
   * The "Callouts & highlights" layout for Bases. Bases may be switched off
   * in a vault, and then there is no layout menu to join.
   */
  private registerPassagesView(): void {
    const passages = new PassagesController(this.app, this.logger);
    this.registerEvent(this.app.vault.on("delete", (file) => passages.forget(file.path)));
    this.registerEvent(this.app.vault.on("rename", (_file, oldPath) => passages.forget(oldPath)));
    const words = t().passages;
    this.registerBasesView(PASSAGES_VIEW_TYPE, {
      name: words.viewName,
      icon: "quote",
      factory: (controller, containerEl) => new PassagesView(controller, containerEl, passages),
      options: () => [
        {
          type: "multitext",
          key: PASSAGE_OPTION.types,
          displayName: words.calloutTypes
        },
        {
          type: "dropdown",
          key: PASSAGE_OPTION.show,
          displayName: words.show,
          default: "both",
          options: {
            both: words.showBoth,
            callouts: words.showCallouts,
            highlights: words.showHighlights
          }
        },
        {
          type: "toggle",
          key: PASSAGE_OPTION.readingView,
          displayName: words.readingView,
          default: false
        }
      ]
    });
  }

  /** Turn Reading view on or off for one base, and say which it is now. */
  private async toggleBaseReading(file: TFile): Promise<void> {
    const flags = this.baseReading;
    if (!flags) return;
    const words = t().bases;
    try {
      const on = await flags.toggle(file);
      new Notice(
        t().common.notice(on ? words.readingOn(file.basename) : words.readingOff(file.basename))
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`bases: could not change ${file.path}`, error);
      new Notice(t().common.notice(words.readingFailed(file.basename, detail)), 8000);
    }
  }

  private startProperties(
    properties: PropertyController,
    sets: PropertySetController,
    controls: PropertyWidgetControls
  ): void {
    const register = (doc: Document, type: string, handler: (event: Event) => void) => {
      this.registerDomEvent(doc, type as keyof DocumentEventMap, handler, { capture: true });
    };
    properties.attach(window, register);
    controls.attach(window, register);
    this.registerEvent(
      this.app.workspace.on("window-open", (_workspaceWindow, win) => {
        properties.attach(win, register);
        controls.attach(win, register);
      })
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (_workspaceWindow, win) => {
        properties.detach(win);
        controls.detach(win);
      })
    );
    properties.start();

    // The Properties widget is drawn when a note opens and when a view
    // switches between reading and editing; each is a moment to put the
    // controls beside "Add property" again.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        sets.noteOpened(file);
        controls.decorateSoon();
      })
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => controls.decorateSoon()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => controls.decorateSoon()));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => sets.noteChanged(file)));
    const setFolderTouched = (path: string) => sets.vaultChanged(path);
    this.registerEvent(this.app.vault.on("modify", (file) => setFolderTouched(file.path)));
    this.registerEvent(this.app.vault.on("create", (file) => setFolderTouched(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => setFolderTouched(file.path)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        setFolderTouched(oldPath);
        setFolderTouched(file.path);
      })
    );
  }

  override onunload(): void {
    this.unloaded = true;
    uninstallIconFont();
    this.linkMode?.stop();
    this.properties?.stop();
    this.propertyControls?.stop();
    this.pictureActions?.stop();
    this.pictureArticles?.stop();
    this.draftWidth.stop();
    this.print?.stop();
    this.proofread?.stop();
    void this.explorer?.stop();
    // Anything still asking the pane's controller after this — a late vault
    // event, a view being torn down — finds none rather than a stopped one.
    this.explorer = null;
    this.sections?.stop();

    this.semantic?.dispose();
    // A caller holding the object finds it answering nothing; one asking the
    // registry again finds no API at all.
    this.api = null;
    this.clearOverlay();
  }

  /** The picture a description note describes, when the vault still has it. */
  private describedPicture(notePath: string): TFile | null {
    const image = this.explorer?.imageDescribedBy(notePath) ?? null;
    const picture = image === null ? null : this.app.vault.getAbstractFileByPath(image);
    return picture instanceof TFile ? picture : null;
  }

  private vaultHit(path: string): { kind: "note" | "image"; id: string; title: string } | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const picture = this.describedPicture(path);
    if (picture) return { kind: "image", id: picture.path, title: picture.basename };
    const title = this.app.metadataCache.getFileCache(file)?.frontmatter?.title;
    return { kind: "note", id: path, title: typeof title === "string" ? title : file.basename };
  }

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
      links: (path) => this.linkItems(explorer, path),
      recommend: (path) => this.recommend(path),
      titleOf: (path) => explorer.displayTitle(path),
      open: async (path, where) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file) await explorer.open(file, where);
      },
      openItem: (key) => this.openItem(key),
      count: () => this.settings.recommendedCount,
      showMenu: (path, event) => explorer.showMenuForPath(path, event),
      glyphOf: (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        const chosen = explorer.iconFor(path);
        return file instanceof TFile
          ? fileGlyph(chosen, { kind: "file", extension: file.extension, name: file.name })
          : fileGlyph(chosen, { kind: "other" });
      },
      copyLink: (link) => void this.copyLink(link),
      relevanceFloors: (kind) => this.relevanceFloors(kind),
      warn: (message, error) => this.logger.warn(message, error)
    };
  }

  /** The model's measured floors, as the Recommended meter reads likeness. */
  private relevanceFloors(kind: "file" | "item"): RelevanceFloors {
    const model = embeddingModelConfig(this.semantic?.modelId() ?? DEFAULT_EMBEDDING_MODEL_ID);
    const floors = kind === "item" ? model.conversationFloors : model.relatedFloors;
    return { balanced: floors[DEFAULT_SIMILARITY_PRESET], strict: floors.strict };
  }

  /** An entry's link on the clipboard, said either way: a file's `obsidian://`
   *  link, or the one an item's source gives. */
  private async copyLink(link: EntryLink): Promise<void> {
    const url =
      link.kind === "file"
        ? obsidianFileUrl(this.app.vault.getName(), link.path)
        : this.semantic?.sources.link(link.key);
    if (!url) return;
    const labels = t().explorer.related;
    await copyText(url, { copied: labels.copied, failed: labels.copyFailed }, this.logger);
  }

  /** A source opens its item itself when it can; otherwise its link does. */
  private openItem(key: string): void {
    const sources = this.semantic?.sources;
    if (!sources || sources.open(key)) return;
    const link = sources.link(key);
    if (link) window.open(link);
  }

  /**
   * A plugin registered a source nobody has answered for: ask, once a
   * session. The notice stays until answered; pressed away it is "not now",
   * and the next launch asks again. Nothing the source lists is read until
   * the answer is yes, here or in the settings, which are also where a yes is
   * taken back.
   */
  private askSourceConsent(id: string, plural: string): void {
    if (this.askedSources.has(id)) return;
    this.askedSources.add(id);
    const name = communityPluginName(this.app, id) ?? id;
    const words = t().semantic.sources;
    showChoiceNotice(
      t().common.notice(words.asks(name, plural)),
      [
        { label: words.allow, run: () => void this.answerSource(id, true) },
        { label: words.notNow, run: () => undefined }
      ],
      0
    );
  }

  /** The person's answer for a source, kept, and the index told. */
  async answerSource(id: string, allowed: boolean): Promise<void> {
    this.settings.semanticSources = { ...this.settings.semanticSources, [id]: allowed };
    await this.saveSettings();
    await this.semantic?.sources.consentChanged(id);
  }

  /**
   * Forget a source the person answered for, whether or not its plugin is
   * still here: the answer goes, and so do its files. A plugin that registers
   * again is asked afresh.
   */
  async forgetSource(id: string): Promise<void> {
    const answers = { ...this.settings.semanticSources };
    delete answers[id];
    this.settings.semanticSources = answers;
    await this.saveSettings();
    this.askedSources.delete(id);
    await this.semantic?.sources.consentChanged(id);
    await this.semantic?.sources.removeFiles(id);
  }

  /** The link graph's answer alone, a description note shown as its picture. */
  private linkItems(explorer: ExplorerController, path: string): RecommendedItem[] {
    return foldDescriptions(
      explorer.relatedCards(path),
      (note) => this.describedPicture(note)?.path ?? null
    ).flatMap((entry): RecommendedItem[] => {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) return [];
      // One whose picture is gone had nothing to fold into: it is not a note.
      if (!entry.picture && explorer.isDescriptionNote(file.path)) return [];
      if (entry.picture) {
        const src = this.app.vault.getResourcePath(file);
        return [
          {
            kind: "picture",
            picture: { path: file.path, title: file.basename, src, reasons: entry.reasons }
          }
        ];
      }
      const title = explorer.titleFor(file) ?? file.basename;
      const card = { path: file.path, title, folder: folderOf(file), reasons: entry.reasons };
      return [{ kind: "note", card }];
    });
  }

  /**
   * The link graph and search by meaning together, for one note. Null when
   * search by meaning is off, so the panel keeps the graph's answer alone.
   */
  private async recommend(
    path: string,
    count = this.settings.recommendedCount
  ): Promise<Recommendation | null> {
    const explorer = this.explorer;
    const engine = this.semantic;
    if (!explorer || !engine?.enabled()) return null;
    const found = await engine.relatedToNote(path, Math.max(RECOMMEND_LIMIT, count));
    const cards = explorer.relatedCards(path);
    // A description note whose picture is gone had nothing to fold into, and
    // is left out rather than recommended as a note.
    const graph = foldDescriptions(
      cards,
      (note) => this.describedPicture(note)?.path ?? null
    ).filter((entry) => entry.picture || !explorer.isDescriptionNote(entry.path));

    // One meaning ranking over the vault: a description note stands for its
    // picture, here as in the Explorer and in the graph, and keeps the score
    // it earned.
    const pictures = new Map<string, TFile>();
    for (const entry of graph) {
      const picture = entry.picture ? this.app.vault.getAbstractFileByPath(entry.path) : null;
      if (picture instanceof TFile) pictures.set(picture.path, picture);
    }
    const byMeaning: { key: string; score: number }[] = [];
    for (const hit of found.notes) {
      const picture = this.describedPicture(hit.id);
      if (picture) {
        pictures.set(picture.path, picture);
        byMeaning.push({ key: picture.path, score: hit.score });
        continue;
      }
      const note = this.app.vault.getAbstractFileByPath(hit.id);
      if (
        note instanceof TFile &&
        !explorer.isTrashed(note.path) &&
        !explorer.isDescriptionNote(note.path)
      )
        byMeaning.push({ key: note.path, score: hit.score });
    }

    const known = new Map(cards.map((card) => [card.path, card]));
    const items: RecommendedItem[] = [];
    // An item this note was attached to stands with the notes it links.
    const attached = engine.sources.attachedTo(path);
    const ranked = recommendNotes(
      withAttached(graph, attached),
      meaningOrder(
        { hits: byMeaning, floor: found.notesFloor },
        { hits: found.items, floor: found.itemsFloor }
      ),
      count
    );
    for (const entry of ranked) {
      const parts = splitItemKey(entry.path);
      if (parts !== null) {
        const source = engine.sources.descriptorOf(parts.source);
        if (!source) continue;
        items.push({
          kind: "item",
          item: {
            key: entry.path,
            title: engine.sources.titleOf(entry.path) ?? t().explorer.related.untitled,
            label: source.label,
            ...(source.icon ? { icon: source.icon } : {}),
            linkable: engine.sources.link(entry.path) !== null,
            reasons: entry.reasons
          }
        });
        continue;
      }
      const picture = pictures.get(entry.path);
      if (picture) {
        items.push({
          kind: "picture",
          picture: {
            path: picture.path,
            title: picture.basename,
            src: this.app.vault.getResourcePath(picture),
            reasons: entry.reasons
          }
        });
        continue;
      }
      const card = known.get(entry.path);
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) continue;
      items.push({
        kind: "note",
        card: {
          path: entry.path,
          title: card?.title ?? explorer.titleFor(file) ?? file.basename,
          folder: folderOf(file),
          reasons: entry.reasons
        }
      });
    }
    return { items };
  }

  /**
   * What Recommended would list beside a note, for the tags of its notes:
   * links and meaning when search by meaning is on, the link graph alone
   * otherwise. Which of these vote is `votingNotes`' to decide.
   */
  private async recommendedEntries(path: string): Promise<RecommendedEntry[]> {
    const explorer = this.explorer;
    if (!explorer) return [];
    const found = await this.recommend(path, TAG_NEIGHBOUR_REQUEST);
    const items = found?.items ?? this.linkItems(explorer, path);
    return items.map((item): RecommendedEntry => {
      switch (item.kind) {
        case "note":
          return { path: item.card.path, isNote: true, reasons: item.card.reasons };
        case "picture":
          return { path: item.picture.path, isNote: false, reasons: item.picture.reasons };
        case "item":
          return { path: item.item.key, isNote: false, reasons: item.item.reasons };
      }
    });
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

  /** The Explorer filter's text index, for the settings: null while no pane
   *  has read the vault's text. */
  textSearchStats(): { notes: number; words: number; readMs: number | null } | null {
    for (const leaf of this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE)) {
      if (leaf.view instanceof ExplorerPaneView) {
        const stats = leaf.view.textStats();
        if (stats) return stats;
      }
    }
    return null;
  }

  private createExplorerView(leaf: WorkspaceLeaf): ExplorerPaneView {
    const view = new ExplorerPaneView(leaf);
    if (this.explorer && this.sections) {
      view.connect({
        explorer: this.explorer,
        sections: this.sections,
        settings: () => this.settings,
        meaning: async (text, limit) => (await this.semantic?.search(text, limit)) ?? [],
        items: async (text, limit) => {
          const engine = this.semantic;
          if (!engine) return [];
          return (await engine.findItems(text, limit)).flatMap((hit) => {
            const source = engine.sources.descriptorOf(hit.source);
            return source
              ? [{ ...hit, plural: source.plural, ...(source.icon ? { icon: source.icon } : {}) }]
              : [];
          });
        },
        openItem: (key) => this.openItem(key),
        warm: () => this.semantic?.warm(),
        meaningState: () => this.semantic?.searchState() ?? "none",
        onMeaningChange: (listener) => this.semantic?.onChange(listener) ?? (() => undefined),
        logger: this.logger
      });
    }
    return view;
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

    // The two lists above the tree are a snapshot of the vault. The bookmarks
    // file costs a re-read whenever it changes; the Latest list reads only
    // paths, names and sync records, so a save of any other note leaves it
    // as it is, and a file appearing, going or moving marks it for recomputing.
    const touched = (file: TAbstractFile): void => {
      if (this.sections?.isBookmarksFile(file.path)) void this.sections.reload();
      this.sections?.invalidateLatest();
    };

    this.registerEvent(this.app.vault.on("create", touched));
    this.registerEvent(this.app.vault.on("delete", touched));
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.sections?.isBookmarksFile(file.path)) void this.sections.reload();
      })
    );

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
      this.app.workspace.on("file-menu", (menu, file, source) => {
        // Obsidian's own file list is what these are for. Not when
        // Schreibstube's pane passes its folder menu on to other plugins: it
        // has both entries already, and used to show "Copy path" twice.
        if (!(file instanceof TFolder) || source === FOREIGN_MENU_SOURCE) return;
        menu.addItem((item) =>
          item
            .setTitle(t().explorer.bookmarks.copyPath)
            .setIcon("link")
            .setSection("info")
            .onClick(() => void this.explorer?.run("copy-path", file))
        );
        if (this.settings.imageDescriptionsEnabled) {
          menu.addItem((item) =>
            item
              .setTitle(t().explorer.menu.describeFolder)
              .setIcon("scan-text")
              .setSection("action")
              .onClick(() => void this.folderDescriber.describe(file))
          );
        }
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

  private get folderDescriber(): FolderDescriber {
    this.folderDescriberInstance ??= new FolderDescriber(
      this.app,
      () => this.settings,
      () => this.requireLlm(),
      () => this.explorer,
      this.logger
    );
    return this.folderDescriberInstance;
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
      this.track(this.catchUpPoll(), "The catch-up poll");
    }, POLL_CATCHUP_DELAY_MS);

    this.register(() => window.clearTimeout(catchUp));
  }

  private handlePollTick(now: Date): void {
    const schedule = this.activePollSchedule();
    if (!schedule) return;
    if (!shouldFire(schedule, now, this.lastPollMinute)) return;

    this.lastPollMinute = minuteOf(now);
    this.track(this.runPoll(), "The scheduled poll");
  }

  /**
   * Work nobody is waiting for — a poll, a record written — whose failure
   * used to be an unhandled rejection: said once, in the log with what it
   * was and on screen with why.
   */
  private track(work: Promise<unknown>, what: string): void {
    work.catch((error: unknown) => {
      this.logger.warn(`${what} failed:`, error);
      const detail = error instanceof Error ? error.message : String(error);
      new Notice(t().common.notice(t().common.taskFailed(detail)));
    });
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
        const proofread = this.proofread;
        if (proofread && file instanceof TFile && file.extension === "md") {
          void proofread.invalidateGlossary(file.path);
          // A mirrored note made level with its source by any route leaves
          // "Extern aktualisiert" now, not at its next check.
          this.track(proofread.noteModified(file), `Settling ${file.path}`);
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
        const proofread = this.proofread;
        if (proofread && file instanceof TFile) {
          this.track(
            proofread.handleNoteRenamed(oldPath, file.path),
            `Moving the sync record of ${oldPath}`
          );
          // A term note that moves takes its rules with it; the metadata
          // cache does not report a move as a change.
          void proofread.termNoteChanged(oldPath);
          void proofread.termNoteChanged(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        const proofread = this.proofread;
        if (proofread && file instanceof TFile) {
          this.track(
            proofread.handleNoteDeleted(file.path),
            `Dropping the sync record of ${file.path}`
          );
          void proofread.termNoteChanged(file.path);
        }
      })
    );

    // A binding removed or changed on another device reaches this one only as
    // a note whose frontmatter now says so. Asked only of notes that have a
    // record, so an ordinary save costs a lookup and nothing more.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        const proofread = this.proofread;
        if (!proofread) return;
        if (this.settings.syncState[file.path] !== undefined) {
          this.track(
            proofread.reconcileSyncRecords([file.path]),
            `Reconciling the sync record of ${file.path}`
          );
        }
        void proofread.termNoteChanged(file.path);
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
    // A changed bookmarks path only matters once the pane has been told;
    // nothing else watches the settings object. The Latest list is not told
    // here: it reads the sync records, and the store says when those change.
    void this.sections?.reloadIfPathChanged();
    this.recommendedFooter?.sync();

    this.propertyControls?.decorateSoon();
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

  async updateExchangeRates(): Promise<void> {
    await this.sums?.updateRates(true);
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

  printTemplates(): PrintTemplate[] {
    return this.print?.templates() ?? [];
  }

  async addPrintTemplate(): Promise<void> {
    await this.print?.addTemplate();
  }

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
      base: file?.extension === "base",
      image: file !== null && getImageMimeType(file.extension) !== null,
      selection: (view?.editor.getSelection().trim().length ?? 0) > 0,
      bound:
        file !== null && hasSourceBinding(this.app.metadataCache.getFileCache(file)?.frontmatter),
      explorerOpen: this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE).length > 0
    };
  }

  /**
   * A command that is only offered when it could do something.
   *
   * Obsidian calls the check twice: once to ask whether to list the command,
   * and again with `checking` false to run it. The condition is the same both
   * times, so a command cannot be run from a state it was hidden in.
   */
  /**
   * Every command with its icon, from `services/command-icons`: the mobile
   * toolbar draws a command without one as a question mark. A command that
   * names its own keeps it.
   */
  override addCommand(command: Command): Command {
    const icon = command.icon ?? commandIcon(command.id);
    return super.addCommand(icon === undefined ? command : { ...command, icon });
  }

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

  private newDoc(): void {
    void this.notes?.createUntitled({ withoutRecommendations: true, draftWidth: true });
  }

  /**
   * `obsidian://schreibstube-new-doc`, so New doc can sit on a shortcut of the
   * system's rather than one that works only while Obsidian is in front.
   * Nothing the link carries is read: Obsidian takes `vault` itself, and a
   * link that could say where the note goes or what it holds would be one
   * any web page could write into the vault with.
   */
  private registerNewDocLink(): void {
    this.registerObsidianProtocolHandler(NEW_DOC_ACTION, () => {
      // A link that started Obsidian arrives before the workspace is laid
      // out, and a window opened then is lost when the layout is restored.
      this.app.workspace.onLayoutReady(() => this.newDoc());
    });
  }

  private registerCommands(): void {
    this.addCommand({
      id: "create-untitled-note",
      name: t().commands.newNote,
      callback: () => this.newDoc()
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

    this.addGatedCommand("add-property-set", t().commands.addPropertySet, "property-set", () => {
      void this.propertySets?.pick(this.app.workspace.getActiveFile());
    });

    this.addGatedCommand("suggest-tags", t().commands.suggestTags, "property-set", () => {
      void this.tagSuggest?.open(this.app.workspace.getActiveFile());
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

    // Opens the pane when it is shut, so a hotkey is the whole route from
    // anywhere in the vault to typing a search.
    this.addCommand({
      id: "explorer-focus-filter",
      name: t().commands.focusExplorerFilter,
      callback: () => {
        void (async () => {
          await this.activateExplorerPane();
          for (const leaf of this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE)) {
            if (leaf.view instanceof ExplorerPaneView) {
              leaf.view.focusFilter();
              return;
            }
          }
        })();
      }
    });

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
        const proofread = this.proofread;
        if (!proofread) return;
        this.track(
          proofread.pollAllSources("manual").then(async (summary) => {
            if (!summary.skipped) {
              this.settings.syncLastPollAt = Date.now();
              await this.saveSettings();
            }
            new Notice(t().common.notice(describePollSummary(summary, { scope: "vault" })));
          }),
          "The poll"
        );
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

    // The base in front of the person opens its notes for reading, or stops.
    this.addGatedCommand("base-reading-view", t().commands.baseReadingView, "base-reading", () => {
      const file = this.app.workspace.getActiveFile();
      if (isBaseFile(file)) void this.toggleBaseReading(file);
      else new Notice(t().common.notice(t().bases.noBase));
    });

    this.addGatedCommand("print-note", t().commands.print, "print", () => {
      void this.print?.printActiveNote();
    });

    // The same print without the dialog, for a note that is printed as it is
    // again and again.
    this.addGatedCommand("print-note-quick", t().commands.printQuick, "print", () => {
      void this.print?.printActiveNoteQuickly();
    });

    // Only what is marked, with the note's template: the CV out of a long
    // application, one chapter of a manuscript.
    this.addGatedCommand("print-selection", t().commands.printSelection, "print-selection", () => {
      void this.print?.printActiveSelection();
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

    // Where there is no status bar — a phone — the total is a command away.
    this.addCommand({
      id: "sum-selection",
      name: t().commands.sumSelection,
      editorCallback: (editor) => {
        this.sums?.sumSelection(editor);
      }
    });

    this.addCommand({
      id: "freeze-totals",
      name: t().commands.freezeTotals,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.sums?.freezeNote(file);
        return true;
      }
    });

    this.addCommand({
      id: "update-exchange-rates",
      name: t().commands.updateRates,
      callback: () => {
        void this.updateExchangeRates();
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
