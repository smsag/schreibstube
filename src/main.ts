import { MarkdownView, Notice, Plugin, WorkspaceLeaf, normalizePath } from "obsidian";
import { resolveAncestorStack } from "./services/ancestor-stack";
import { buildHeadingIndex } from "./services/heading-index";
import {
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
import { generateImageRenameFilename, generateRenameFilename, sanitizeFilename } from "./services/llm-rename";
import { MAX_IMAGE_BYTES, getImageMimeType, resizeImageToBase64 } from "./services/image-resize";
import { SchreibstubeSettingTab } from "./settings";
import type { FocusMode, HeadingEntry, SchreibstubeSettings } from "./types";

export default class SchreibstubePlugin extends Plugin {
  settings: SchreibstubeSettings = DEFAULT_SETTINGS;
  private currentView: MarkdownView | null = null;
  private viewportTopLine = 0;
  private headingIndex: HeadingEntry[] = [];
  private lastIndexedContent = "";
  private ancestorStack: HeadingEntry[] = [];
  private lastRenderSignature = "";
  private overlayCoordinator = new OverlayCoordinator();
  private refreshScheduler: RefreshScheduler | null = null;
  private linkOpenMode: "default" | "left" | "right" = "default";
  private linkTargetLeaf: WorkspaceLeaf | null = null;
  private linkModeStatusEl: HTMLElement | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private originalOpenLinkText: ((...args: any[]) => Promise<void>) | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.refreshScheduler = new RefreshScheduler(
      (callback) => window.requestAnimationFrame(callback),
      ({ viewportTopLine, options }) => this.refreshForActiveView(viewportTopLine, options)
    );

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
      },
    });

    this.linkModeStatusEl = this.addStatusBarItem();
    this.updateLinkModeStatus();
    this.registerDomEvent(document, "click", (e: MouseEvent) => {
      void this.handleLinkClick(e);
    }, true);

    this.patchOpenLinkText();
    this.registerCommands();
    this.addSettingTab(new SchreibstubeSettingTab(this.app, this));
    this.requestOverlayRefresh();
  }

  onunload(): void {
    this.unpatchOpenLinkText();
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

  async updateDimOpacity(dimOpacity: number): Promise<void> {
    this.settings = normalizeSettings({
      ...this.settings,
      focusDimOpacity: dimOpacity,
    });
    await this.saveSettings();
    this.notifyFocusSettingsChanged();
  }

  private registerCommands(): void {
    this.addCommand({
      id: "set-focus-sentence-mode",
      name: "Focus Mode: Sentence",
      callback: () => { void this.setFocusMode("sentence"); },
    });

    this.addCommand({
      id: "set-focus-paragraph-mode",
      name: "Focus Mode: Paragraph",
      callback: () => { void this.setFocusMode("paragraph"); },
    });

    this.addCommand({
      id: "disable-focus-mode",
      name: "Focus Mode: Disable",
      callback: () => { void this.setFocusMode("off"); },
    });

    this.addCommand({
      id: "rename-from-content",
      name: "Rename file from content",
      callback: () => { void this.executeRenameFromContent(); },
    });

    this.addCommand({
      id: "rename-image-from-content",
      name: "Rename image from content",
      callback: () => { void this.executeRenameImageFromContent(); },
    });

    this.addCommand({
      id: "open-links-left",
      name: "Open links to the left",
      callback: () => { this.setLinkOpenMode("left"); },
    });

    this.addCommand({
      id: "open-links-right",
      name: "Open links to the right",
      callback: () => { this.setLinkOpenMode("right"); },
    });

    this.addCommand({
      id: "open-links-default",
      name: "Open links normally",
      callback: () => { this.setLinkOpenMode("default"); },
    });
  }

  private async setFocusMode(mode: FocusMode): Promise<void> {
    this.settings = normalizeSettings({
      ...this.settings,
      focusMode: mode,
    });
    await this.saveSettings();
    this.notifyFocusSettingsChanged();
  }

  private notifyFocusSettingsChanged(): void {
    window.dispatchEvent(new Event("schreibstube-focus-settings-changed"));
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

    const sig = this.ancestorStack
      .map((e) => `${e.level}:${e.lineNumber}:${e.text}`)
      .join("|");
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
    const line = reduceOverlayRowEvent(event);
    this.navigateToLine(line);
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

  private patchOpenLinkText(): void {
    const ws = this.app.workspace as any;
    this.originalOpenLinkText = ws.openLinkText.bind(ws);
    ws.openLinkText = async (linkText: string, sourcePath: string, newLeaf?: unknown, openViewState?: unknown) => {
      if (this.linkOpenMode !== "default") {
        const leaves = this.app.workspace.getLeavesOfType("markdown");
        let sourceLeaf: WorkspaceLeaf | null = null;
        for (const leaf of leaves) {
          if ((leaf.view as MarkdownView).file?.path === sourcePath) {
            sourceLeaf = leaf;
            break;
          }
        }
        if (!sourceLeaf) sourceLeaf = this.app.workspace.getMostRecentLeaf();
        if (sourceLeaf) await this.openLinkInSidePane(linkText, sourceLeaf);
      } else {
        return this.originalOpenLinkText!(linkText, sourcePath, newLeaf, openViewState);
      }
    };
  }

  private unpatchOpenLinkText(): void {
    if (this.originalOpenLinkText) {
      (this.app.workspace as any).openLinkText = this.originalOpenLinkText;
      this.originalOpenLinkText = null;
    }
  }

  private setLinkOpenMode(mode: "default" | "left" | "right"): void {
    this.linkOpenMode = mode;
    this.linkTargetLeaf = null;
    this.updateLinkModeStatus();
  }

  private updateLinkModeStatus(): void {
    if (!this.linkModeStatusEl) return;
    if (this.linkOpenMode === "default") {
      this.linkModeStatusEl.style.display = "none";
      this.linkModeStatusEl.setText("");
    } else {
      this.linkModeStatusEl.style.display = "";
      this.linkModeStatusEl.setText(this.linkOpenMode === "left" ? "← links" : "links →");
    }
  }

  private async handleLinkClick(e: MouseEvent): Promise<void> {
    if (this.linkOpenMode === "default") return;

    const target = e.target as HTMLElement;
    const linkEl = target.closest("a.internal-link") as HTMLAnchorElement | null;
    if (!linkEl) return;

    const href = linkEl.dataset.href ?? linkEl.getAttribute("href") ?? "";
    if (!href || /^https?:\/\//.test(href)) return;

    e.preventDefault();
    e.stopPropagation();

    // Identify which leaf the click originated in
    let sourceLeaf: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if ((leaf as any).containerEl.contains(target)) sourceLeaf = leaf;
    });
    if (!sourceLeaf) return;

    await this.openLinkInSidePane(href, sourceLeaf);
  }

  private async openLinkInSidePane(linkText: string, sourceLeaf: WorkspaceLeaf): Promise<void> {
    const sourcePath = sourceLeaf.view instanceof MarkdownView
      ? (sourceLeaf.view.file?.path ?? "")
      : "";

    // Separate the file path from any heading/block subpath
    const subpathMatch = linkText.match(/^([^#^]*)([#^].*)?$/);
    const linkPath = subpathMatch?.[1] ?? linkText;
    const subpath = subpathMatch?.[2] ?? "";

    const file = this.app.metadataCache.getFirstLinkpathDest(linkPath || linkText, sourcePath);
    if (!file) return;

    // Reuse existing side pane if still open, otherwise create one
    if (this.linkTargetLeaf && !this.linkTargetLeaf.view.containerEl.isConnected) {
      this.linkTargetLeaf = null;
    }
    if (!this.linkTargetLeaf) {
      const before = this.linkOpenMode === "left";
      this.linkTargetLeaf = (this.app.workspace as any).createLeafBySplit(sourceLeaf, "vertical", before);
    }

    const targetLeaf = this.linkTargetLeaf!;
    await targetLeaf.openFile(file, subpath ? { eState: { subpath } } : undefined);

    // Return focus to the note the user was reading
    this.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
  }

  private async executeRenameImageFromContent(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const mimeType = getImageMimeType(file.extension);
    if (!mimeType) {
      new Notice("Schreibstube: unsupported format — supported image types: jpg, png, gif, webp.");
      return;
    }

    if (file.stat.size > MAX_IMAGE_BYTES) {
      new Notice("Schreibstube: image exceeds the 10 MB limit.");
      return;
    }

    const secretName = this.settings.renameSecretName;
    if (!secretName) {
      new Notice("Schreibstube: no secret selected — open Settings to choose one.");
      return;
    }
    const apiKey = this.app.secretStorage.getSecret(secretName);
    if (!apiKey) {
      new Notice("Schreibstube: secret not found — check Settings.");
      return;
    }

    const buffer = await this.app.vault.readBinary(file);

    let base64Image: string;
    try {
      base64Image = await resizeImageToBase64(buffer, mimeType, this.settings.renameMaxImagePx);
    } catch {
      new Notice("Schreibstube: could not process image.");
      return;
    }

    let proposed: string;
    try {
      proposed = await generateImageRenameFilename(base64Image, mimeType, this.settings, apiKey);
    } catch (err) {
      new Notice(`Schreibstube: rename failed — ${err instanceof Error ? err.message : "unknown error"}`);
      return;
    }

    const sanitized = sanitizeFilename(proposed, this.settings.renameMaxFilenameLength);
    if (!sanitized) {
      new Notice("Schreibstube: rename failed — the LLM returned an unusable filename.");
      return;
    }

    const folder = file.parent?.path ?? "";
    const newPath = normalizePath(`${folder}/${sanitized}.${file.extension}`);

    try {
      await this.app.fileManager.renameFile(file, newPath);
    } catch {
      new Notice("Schreibstube: rename failed — a file with that name may already exist.");
      return;
    }
  }

  private async executeRenameFromContent(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;

    const content = view.editor.getValue().trim();
    if (content.length < this.settings.renameMinContentChars) return;

    const secretName = this.settings.renameSecretName;
    if (!secretName) {
      new Notice("Schreibstube: no secret selected — open Settings to choose one.");
      return;
    }
    const apiKey = this.app.secretStorage.getSecret(secretName);
    if (!apiKey) {
      new Notice("Schreibstube: secret not found — check Settings.");
      return;
    }

    const truncated = content.slice(0, this.settings.renameMaxContentChars);

    let proposed: string;
    try {
      proposed = await generateRenameFilename(truncated, this.settings, apiKey);
    } catch (err) {
      new Notice(`Schreibstube: rename failed — ${err instanceof Error ? err.message : "unknown error"}`);
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
