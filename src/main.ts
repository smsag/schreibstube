import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
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
import { MailCommands } from "./controllers/mail-commands";
import { PublishCommands } from "./controllers/publish-commands";
import { SchreibstubeSettingTab } from "./settings";
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
  /** Guards against firing twice inside one scheduled minute. */
  private lastPollMinute = -1;
  private mail: MailCommands | null = null;
  private publish: PublishCommands | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.logger.debug("Loading Schreibstube.");

    this.refreshScheduler = new RefreshScheduler(
      (callback) => window.requestAnimationFrame(callback),
      ({ viewportTopLine, options }) => this.refreshForActiveView(viewportTopLine, options)
    );

    this.linkMode = new LinkModeController(this.app, this.logger);
    this.llm = new LlmCommands(this.app, () => this.settings, this.logger);
    this.mail = new MailCommands(this.app, () => this.settings, this.logger);
    this.publish = new PublishCommands(this.app, () => this.settings, this.logger);
    this.proofread = new ProofreadController(this.app, () => this.settings, this.logger, {
      get: (path) => this.settings.syncState[path],
      set: async (path, record) => {
        this.settings.syncState = { ...this.settings.syncState, [path]: record };
        await this.saveSettings();
      },
      setMany: async (records) => {
        this.settings.syncState = { ...this.settings.syncState, ...records };
        await this.saveSettings();
      },
      forget: async (path) => {
        const { [path]: _removed, ...rest } = this.settings.syncState;
        this.settings.syncState = rest;
        await this.saveSettings();
      }
    });

    this.registerView(REVIEW_VIEW_TYPE, (leaf) => this.createReviewView(leaf));
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
    this.addSettingTab(new SchreibstubeSettingTab(this.app, this));
    this.requestOverlayRefresh();
  }

  onunload(): void {
    this.linkMode?.stop();
    this.proofread?.stop();
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
      return;
    }
    await leaf.setViewState({ type: REVIEW_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
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
      new Notice(
        `Schreibstube: ${summary.withChanges} Notiz(en) mit Aktualisierungen aus der Quelle.`
      );
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
      name: "Focus Mode: Sentence",
      callback: () => {
        void this.setFocusMode("sentence");
      }
    });

    this.addCommand({
      id: "set-focus-paragraph-mode",
      name: "Focus Mode: Paragraph",
      callback: () => {
        void this.setFocusMode("paragraph");
      }
    });

    this.addCommand({
      id: "disable-focus-mode",
      name: "Focus Mode: Disable",
      callback: () => {
        void this.setFocusMode("off");
      }
    });

    this.addCommand({
      id: "rename-from-content",
      name: "Rename file from content",
      callback: () => {
        void this.llm?.renameFromContent();
      }
    });

    this.addCommand({
      id: "rename-image-from-content",
      name: "Rename image from content",
      callback: () => {
        void this.llm?.renameImageFromContent();
      }
    });

    this.addCommand({
      id: "summarize-selection",
      name: "Summarize selection",
      editorCallback: () => {
        void this.llm?.summarizeSelection();
      }
    });

    this.addCommand({
      id: "open-review-panel",
      name: "Open proof-read sidebar",
      callback: () => {
        void this.activateReviewPanel();
      }
    });

    this.addCommand({
      id: "proof-read-note",
      name: "Proof-read note",
      editorCallback: () => {
        void this.activateReviewPanel().then(() => this.proofread?.handlers().onProofread());
      }
    });

    this.addCommand({
      id: "glossary-check-note",
      name: "Check note against glossary",
      editorCallback: () => {
        void this.activateReviewPanel().then(() => this.proofread?.handlers().onGlossaryCheck());
      }
    });

    this.addCommand({
      id: "poll-all-sources",
      name: "Check all bound notes for updates",
      callback: () => {
        void this.proofread?.pollAllSources("manual").then(async (summary) => {
          this.settings.syncLastPollAt = Date.now();
          await this.saveSettings();
          new Notice(
            summary.checked === 0
              ? "Schreibstube: keine gebundenen Notizen geprüft."
              : `Schreibstube: ${summary.checked} geprüft, ${summary.withChanges} mit Aktualisierungen, ${summary.failed} fehlgeschlagen.`
          );
        });
      }
    });

    this.addCommand({
      id: "check-note-source",
      name: "Check note source for updates",
      callback: () => {
        void this.activateReviewPanel().then(() => this.proofread?.handlers().onCheckSource());
      }
    });

    this.addCommand({
      id: "send-note-as-email",
      name: "Send note as email",
      callback: () => {
        void this.mail?.sendNoteAsEmail();
      }
    });

    this.addCommand({
      id: "query-mailbox",
      name: "Query mailbox",
      callback: () => {
        void this.mail?.queryMailbox();
      }
    });

    this.addCommand({
      id: "fetch-replies",
      name: "Fetch replies into note",
      callback: () => {
        void this.mail?.fetchReplies();
      }
    });

    this.addCommand({
      id: "publish-folder",
      name: "Veröffentlichen",
      callback: () => {
        void this.publish?.publish();
      }
    });

    this.addCommand({
      id: "publish-preview",
      name: "Veröffentlichung prüfen",
      callback: () => {
        void this.publish?.preview();
      }
    });

    this.addCommand({
      id: "publish-open-site",
      name: "Website öffnen",
      callback: () => {
        void this.publish?.openSite();
      }
    });

    this.addCommand({
      id: "open-links-left",
      name: "Open links to the left",
      callback: () => {
        this.linkMode?.setMode("left");
      }
    });

    this.addCommand({
      id: "open-links-right",
      name: "Open links to the right",
      callback: () => {
        this.linkMode?.setMode("right");
      }
    });

    this.addCommand({
      id: "open-links-default",
      name: "Open links normally",
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
