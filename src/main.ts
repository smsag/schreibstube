import { MarkdownView, Notice, Plugin, normalizePath } from "obsidian";
import { resolveAncestorStack, resolveSiblingHeadings } from "./services/ancestor-stack";
import { buildHeadingIndex } from "./services/heading-index";
import {
  reduceMouseLeaveCollapse,
  reduceOutsideTapCollapse,
  reduceOverlayRowEvent,
  type OverlayRowEvent
} from "./services/overlay-interaction";
import {
  resolveViewportLineForReadingView,
  scrollReadingHeadingIntoView
} from "./services/reading-navigator";
import { RefreshScheduler, type RefreshOptions } from "./services/refresh-scheduler";
import { OverlayCoordinator } from "./services/overlay-coordinator";
import { bootstrapSchreibstubeRuntime } from "./services/plugin-bootstrap";
import { DEFAULT_SETTINGS, normalizeSettings } from "./services/plugin-settings";
import { generateRenameFilename, sanitizeFilename, secretStorageKey } from "./services/llm-rename";
import { SchreibstubeSettingTab } from "./settings";
import type { HeadingEntry, HeadingLevel, SchreibstubeSettings } from "./types";

export default class SchreibstubePlugin extends Plugin {
  settings: SchreibstubeSettings = DEFAULT_SETTINGS;
  private viewportTopLine = 0;
  private headingIndex: HeadingEntry[] = [];
  private ancestorStack: HeadingEntry[] = [];
  private expandedLevel: HeadingLevel | null = null;
  private lastRenderSignature = "";
  private overlayCoordinator = new OverlayCoordinator();
  private refreshScheduler: RefreshScheduler | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.refreshScheduler = new RefreshScheduler(
      (callback) => window.requestAnimationFrame(callback),
      ({ viewportTopLine, options }) => this.refreshForActiveView(viewportTopLine, options)
    );

    this.addCommand({
      id: "rename-from-content",
      name: "Rename file from content",
      editorCallback: () => { void this.executeRenameFromContent(); },
    });

    bootstrapSchreibstubeRuntime(this, {
      onViewportFromEditor: (viewportTopLine) => {
        this.queueRefreshForActiveView(viewportTopLine);
      },
      onViewportFromReading: ({ viewportTopLine, scrollTop }) => {
        this.queueRefreshForActiveView(viewportTopLine, { readingScrollTop: scrollTop });
      },
      onActiveLeafChange: () => {
        this.requestOverlayRefresh();
      },
      onGlobalPointerDown: (event) => {
        this.handleGlobalPointerDown(event);
      }
    });

    this.addSettingTab(new SchreibstubeSettingTab(this.app, this));

    this.requestOverlayRefresh();
  }

  onunload(): void {
    this.clearOverlay();
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

  private queueRefreshForActiveView(
    viewportTopLine?: number,
    options?: RefreshOptions
  ): void {
    if (!this.refreshScheduler) {
      this.refreshForActiveView(viewportTopLine, options);
      return;
    }

    this.refreshScheduler.enqueue(viewportTopLine, options);
  }

  private refreshForActiveView(
    viewportTopLine?: number,
    options?: RefreshOptions
  ): void {
    if (viewportTopLine !== undefined) {
      this.viewportTopLine = Math.max(0, viewportTopLine);
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.clearOverlay();
      return;
    }

    const content = view.editor.getValue();
    this.headingIndex = buildHeadingIndex(content);

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

    if (
      this.expandedLevel !== null &&
      !this.ancestorStack.some((entry) => entry.level === this.expandedLevel)
    ) {
      this.expandedLevel = null;
    }

    this.renderOverlay();
  }

  private renderOverlay(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.clearOverlay();
      return;
    }

    const sig =
      this.ancestorStack.map(e => `${e.level}:${e.lineNumber}`).join("|") +
      `|exp:${this.expandedLevel}`;
    if (sig === this.lastRenderSignature) return;

    const siblings =
      this.expandedLevel === null
        ? []
        : resolveSiblingHeadings(this.headingIndex, this.ancestorStack, this.expandedLevel);

    const rendered = this.overlayCoordinator.renderForView(
      view,
      {
        ancestorStack: this.ancestorStack,
        expandedLevel: this.expandedLevel,
        siblings,
        maxVisibleRows: this.settings.overlayMaxVisibleRows
      },
      (event) => this.handleOverlayRowEvent(event),
      () => this.handleOverlayMouseLeave()
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
  }

  private handleOverlayRowEvent(event: OverlayRowEvent): void {
    const result = reduceOverlayRowEvent(
      { expandedLevel: this.expandedLevel },
      event,
      this.isTouchDevice()
    );

    this.expandedLevel = result.nextExpandedLevel;

    if (result.navigateToLine !== null) {
      this.navigateToLine(result.navigateToLine);
      return;
    }

    if (result.shouldRender) {
      this.renderOverlay();
    }
  }

  private handleOverlayMouseLeave(): void {
    const result = reduceMouseLeaveCollapse(
      { expandedLevel: this.expandedLevel },
      this.isTouchDevice()
    );

    this.expandedLevel = result.nextExpandedLevel;
    if (result.shouldRender) {
      this.renderOverlay();
    }
  }

  private navigateToLine(lineNumber: number): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return;
    }

    const targetHeading = this.headingIndex.find((entry) => entry.lineNumber === lineNumber);
    if (
      targetHeading &&
      scrollReadingHeadingIntoView(view, this.headingIndex, targetHeading.lineNumber)
    ) {
      this.viewportTopLine = targetHeading.lineNumber;
      this.refreshForActiveView(this.viewportTopLine);
      return;
    }

    view.editor.setCursor(lineNumber, 0);
    view.editor.scrollIntoView({ from: { line: lineNumber, ch: 0 }, to: { line: lineNumber, ch: 0 } }, true);
    this.viewportTopLine = lineNumber;
    this.queueRefreshForActiveView(this.viewportTopLine);
  }

  private handleGlobalPointerDown(event: PointerEvent): void {
    const result = reduceOutsideTapCollapse(
      { expandedLevel: this.expandedLevel },
      this.isTouchDevice(),
      this.overlayCoordinator.contains(event.target)
    );

    this.expandedLevel = result.nextExpandedLevel;
    if (result.shouldRender) {
      this.renderOverlay();
    }
  }

  private isTouchDevice(): boolean {
    return window.matchMedia("(pointer: coarse)").matches;
  }

  private async executeRenameFromContent(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;

    const content = view.editor.getValue().trim();
    if (content.length < this.settings.renameMinContentChars) return;

    const apiKey = this.app.secretStorage.getSecret(
      secretStorageKey(this.settings.renameProvider)
    );
    if (!apiKey) {
      new Notice("Schreibstube: no API key configured — open Settings to add one.");
      return;
    }

    const truncated = content.slice(0, this.settings.renameMaxContentChars);

    let proposed: string;
    try {
      proposed = await generateRenameFilename(truncated, this.settings, apiKey);
    } catch {
      new Notice("Schreibstube: rename failed — could not reach the LLM API.");
      return;
    }

    const sanitized = sanitizeFilename(proposed, this.settings.renameMaxFilenameLength);
    if (!sanitized) {
      new Notice("Schreibstube: rename failed — the LLM returned an unusable filename.");
      return;
    }

    const folder = view.file.parent?.path ?? "";
    const newPath = normalizePath(`${folder}/${sanitized}.md`);

    try {
      await this.app.fileManager.renameFile(view.file, newPath);
    } catch {
      new Notice("Schreibstube: rename failed — a file with that name may already exist.");
      return;
    }
  }

}
