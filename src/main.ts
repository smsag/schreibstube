import {
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
} from "./services/reading-navigator";
import { RefreshScheduler, type RefreshOptions } from "./services/refresh-scheduler";
import { OverlayCoordinator } from "./services/overlay-coordinator";
import { bootstrapSchreibstubeRuntime } from "./services/plugin-bootstrap";
import { DEFAULT_SETTINGS, normalizeSettings } from "./services/plugin-settings";
import { createLogger, type Logger } from "./services/logger";
import { LinkModeController } from "./controllers/link-mode-controller";
import { LlmCommands } from "./controllers/llm-commands";
import { ProofreadController } from "./controllers/proofread-controller";
import { createGlossaryUnderlineExtension } from "./processors/glossary-underline";
import { compileGlossaries } from "./services/glossary-matcher";
import { minuteOf, parseCron, previousRun, shouldFire } from "./services/cron";
import { REVIEW_VIEW_TYPE, ReviewPanelView } from "./ui/review-panel";
import { EXPLORER_RIBBON_ICON, EXPLORER_VIEW_TYPE, ExplorerPaneView } from "./ui/explorer-view";
import { registerSchreibstubeIcon } from "./ui/schreibstube-icon";
import {
  EXPLORER_STATE_FILE,
  EXTERNAL_CHECK_MS,
  ExplorerController
} from "./controllers/explorer-controller";
import type { ExplorerFileStore } from "./services/explorer-store";
import { PaneSectionsController } from "./controllers/pane-sections";
import { BookmarkQuickOpenModal } from "./ui/bookmark-quick-open";
import { vaultUrlFor } from "./services/bookmark-file";
import { MailCommands } from "./controllers/mail-commands";
import { PublishCommands } from "./controllers/publish-commands";
import { SchreibstubeSettingTab } from "./settings/index";
import { setLanguage, t } from "./i18n";
import type { FocusMode, HeadingEntry, SchreibstubeSettings } from "./types";

/** How often the poll ticker wakes. Well under a minute so a scheduled minute
 *  is never stepped over by a late tick. */
const POLL_TICK_MS = 20_000;

/** Delay before the catch-up poll, so it never competes with opening a vault. */
const POLL_CATCHUP_DELAY_MS = 8_000;

export default class SchreibstubePlugin extends Plugin {
  settings: SchreibstubeSettings = DEFAULT_SETTINGS;
  private logger: Logger = createLogger(() => this.settings.debugLogging);
  private currentView: MarkdownView | null = null;
  private viewportTopLine = 0;
  private headingIndex: HeadingEntry[] = [];
  private lastIndexedContent = "";
  private ancestorStack: HeadingEntry[] = [];
  private lastRenderSignature = "";
  private overlayCoordinator = new OverlayCoordinator();
  private refreshScheduler: RefreshScheduler | null = null;
  private linkMode: LinkModeController | null = null;
  private llm: LlmCommands | null = null;
  private proofread: ProofreadController | null = null;
  private explorer: ExplorerController | null = null;
  private sections: PaneSectionsController | null = null;
  /** Guards against firing twice inside one scheduled minute. */
  private lastPollMinute = -1;
  private mail: MailCommands | null = null;
  private publish: PublishCommands | null = null;

  async onload(): Promise<void> {
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
        await this.saveSettings();
      }
    });

    this.explorer = new ExplorerController(
      this.app,
      () => this.settings,
      {
        checkFile: async (file) => this.requireProofread().checkFile(file),
        checkFolder: async (path) => this.requireProofread().checkFolder(path),
        forget: async (path) => this.requireProofread().handleNoteDeleted(path)
      },
      this.logger,
      this.explorerStateFile()
    );
    await this.explorer.start();

    this.sections = new PaneSectionsController(
      this.app,
      () => this.settings,
      this.logger,
      (path) => this.revealInExplorerPanes(path)
    );
    await this.sections.start();

    this.registerView(REVIEW_VIEW_TYPE, (leaf) => this.createReviewView(leaf));
    this.registerView(EXPLORER_VIEW_TYPE, (leaf) => this.createExplorerView(leaf));
    this.registerExplorerEvents();
    this.registerEditorExtension(
      createGlossaryUnderlineExtension({
        getSettings: () => this.settings,
        getMatcher: () => this.proofread?.activeMatcher() ?? compileGlossaries([])
      })
    );
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

  onunload(): void {
    this.linkMode?.stop();
    this.proofread?.stop();
    void this.explorer?.stop();
    this.sections?.stop();
    this.clearOverlay();
  }

  /** Open the review sidebar, reusing the existing leaf if it is already open. */
  async activateReviewPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
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
    const existing = this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
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

  private createExplorerView(leaf: WorkspaceLeaf): ExplorerPaneView {
    const view = new ExplorerPaneView(leaf);
    if (this.explorer && this.sections) {
      view.connect({
        explorer: this.explorer,
        sections: this.sections,
        settings: () => this.settings
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
    if (leaves.length === 0) {
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
    void this.app.workspace.revealLeaf(leaves[0]);
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
    this.settings.syncLastPollAt = Date.now();
    await this.saveSettings();

    if (summary && summary.withChanges > 0) {
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
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = normalizeSettings(loaded);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // A changed bookmarks path, count or exclusion list only matters once the
    // pane has been told; nothing else watches the settings object.
    void this.sections?.reloadIfPathChanged();
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

  private registerCommands(): void {
    this.addCommand({
      id: "set-focus-sentence-mode",
      name: t().commands.focusSentence,
      callback: () => {
        void this.setFocusMode("sentence");
      }
    });

    this.addCommand({
      id: "set-focus-paragraph-mode",
      name: t().commands.focusParagraph,
      callback: () => {
        void this.setFocusMode("paragraph");
      }
    });

    this.addCommand({
      id: "disable-focus-mode",
      name: t().commands.focusDisable,
      callback: () => {
        void this.setFocusMode("off");
      }
    });

    this.addCommand({
      id: "rename-from-content",
      name: t().commands.renameFile,
      callback: () => {
        void this.llm?.renameFromContent();
      }
    });

    this.addCommand({
      id: "rename-image-from-content",
      name: t().commands.renameImage,
      callback: () => {
        void this.llm?.renameImageFromContent();
      }
    });

    this.addCommand({
      id: "summarize-selection",
      name: t().commands.summarize,
      editorCallback: () => {
        void this.llm?.summarizeSelection();
      }
    });

    this.addCommand({
      id: "open-explorer-pane",
      name: t().commands.openExplorer,
      callback: () => {
        void this.activateExplorerPane();
      }
    });

    // Obsidian's own collapse-all is a button on its explorer's header and
    // nothing else: no command, so no hotkey. This one is both.
    this.addCommand({
      id: "collapse-explorer-folders",
      name: t().commands.collapseExplorer,
      callback: () => {
        for (const leaf of this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE)) {
          if (leaf.view instanceof ExplorerPaneView) leaf.view.collapseAll();
        }
      }
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
      id: "glossary-check-note",
      name: t().commands.checkGlossary,
      editorCallback: () => {
        void this.activateReviewPanel().then(() => this.proofread?.handlers().onGlossaryCheck());
      }
    });

    this.addCommand({
      id: "poll-all-sources",
      name: t().commands.syncAll,
      callback: () => {
        void this.proofread?.pollAllSources("manual").then(async (summary) => {
          this.settings.syncLastPollAt = Date.now();
          await this.saveSettings();
          new Notice(
            t().common.notice(
              summary.skipped === "disabled"
                ? t().sync.disabled
                : summary.skipped === "busy"
                  ? t().sync.busy
                  : summary.checked === 0
                    ? t().sync.noneChecked
                    : t().sync.checked(summary.checked, summary.withChanges, summary.failed)
            )
          );
        });
      }
    });

    this.addCommand({
      id: "check-note-source",
      name: t().commands.syncNote,
      callback: () => {
        void this.activateReviewPanel().then(() => this.proofread?.handlers().onCheckSource());
      }
    });

    this.addCommand({
      id: "send-note-as-email",
      name: t().commands.sendMail,
      callback: () => {
        void this.mail?.sendNoteAsEmail();
      }
    });

    this.addCommand({
      id: "query-mailbox",
      name: t().commands.queryMailbox,
      callback: () => {
        void this.mail?.queryMailbox();
      }
    });

    this.addCommand({
      id: "fetch-replies",
      name: t().commands.fetchReplies,
      callback: () => {
        void this.mail?.fetchReplies();
      }
    });

    this.addCommand({
      id: "publish-folder",
      name: t().commands.publish,
      callback: () => {
        void this.publish?.publish();
      }
    });

    this.addCommand({
      id: "publish-preview",
      name: t().commands.publishPreview,
      callback: () => {
        void this.publish?.preview();
      }
    });

    this.addCommand({
      id: "publish-open-site",
      name: t().commands.openSite,
      callback: () => {
        void this.publish?.openSite();
      }
    });

    this.addCommand({
      id: "open-links-left",
      name: t().commands.linksLeft,
      callback: () => {
        this.linkMode?.setMode("left");
      }
    });

    this.addCommand({
      id: "open-links-right",
      name: t().commands.linksRight,
      callback: () => {
        this.linkMode?.setMode("right");
      }
    });

    this.addCommand({
      id: "open-links-default",
      name: t().commands.linksNormal,
      callback: () => {
        this.linkMode?.setMode("default");
      }
    });
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
    if (!this.settings.overlayEnabled) {
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
