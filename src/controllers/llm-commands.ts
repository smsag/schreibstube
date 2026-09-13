import { MarkdownView, Notice, normalizePath, type App, type TFile } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { t } from "../i18n";
import { resolveApiKey } from "../services/secret";
import { MAX_IMAGE_BYTES, getImageMimeType, resizeImageToBase64 } from "../services/image-resize";
import {
  generateImageRenameFilename,
  generateRenameFilename,
  sanitizeFilename,
  stripFilenameExtension
} from "../services/llm-rename";
import { generateSummary } from "../services/llm-summarize";

/**
 * The three LLM-backed commands (rename note, rename image, summarize
 * selection). A single in-flight guard prevents overlapping API calls, and each
 * failure logs the underlying error before showing the user a short Notice, so
 * "it didn't work" reports are diagnosable from the console.
 */
export class LlmCommands {
  private busy = false;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger
  ) {}

  async renameFromContent(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      return;
    }
    const file = view.file;

    const settings = this.getSettings();
    const content = view.editor.getValue().trim();
    if (content.length < settings.renameMinContentChars) {
      this.logger.debug("Rename skipped: content below minimum length.");
      return;
    }

    const apiKey = this.requireApiKey();
    if (!apiKey) {
      return;
    }

    await this.withBusy("rename", async () => {
      const sanitized = await this.nameForNote(content, apiKey);
      if (!sanitized) return;

      const folder = file.parent?.path ?? "";
      await this.renameFile(file, normalizePath(`${folder}/${sanitized}.md`));
    });
  }

  async renameImageFromContent(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return;
    }

    const mimeType = getImageMimeType(file.extension);
    if (!mimeType) {
      new Notice(t().common.notice(t().ai.unsupportedImage));
      return;
    }

    if (file.stat.size > MAX_IMAGE_BYTES) {
      new Notice(t().common.notice(t().ai.imageTooLarge));
      return;
    }

    const apiKey = this.requireApiKey();
    if (!apiKey) {
      return;
    }

    await this.withBusy("image rename", async () => {
      const sanitized = await this.nameForImage(file, mimeType, apiKey);
      if (!sanitized) return;

      const folder = file.parent?.path ?? "";
      await this.renameFile(file, normalizePath(`${folder}/${sanitized}.${file.extension}`));
    });
  }

  /**
   * A name for a file the person is not looking at, without renaming anything.
   *
   * What the pane's menu asks for: the proposal goes into the rename dialog
   * beside the name the file has, where it can be read, edited and refused. A
   * command renames a note in front of you and a menu acts on a row somewhere
   * in a tree, and the second is no place for a silent rename.
   *
   * Null when nothing usable came back. Whoever could not be served has been
   * told by then — an unreadable picture, a note too short to describe itself,
   * a missing key — so the caller opens no dialog and says nothing further.
   */
  async proposeName(file: TFile): Promise<string | null> {
    const apiKey = this.requireApiKey();
    if (!apiKey) return null;

    const mimeType = getImageMimeType(file.extension);
    if (mimeType) {
      if (file.stat.size > MAX_IMAGE_BYTES) {
        new Notice(t().common.notice(t().ai.imageTooLarge));
        return null;
      }

      return this.withBusy("image rename", () => this.nameForImage(file, mimeType, apiKey));
    }

    if (file.extension !== "md") {
      new Notice(t().common.notice(t().ai.cannotName));
      return null;
    }

    // Read from the vault and not from an editor: this note is not open, and
    // when it is, what was last saved is what a check like this is entitled to.
    const content = (await this.app.vault.cachedRead(file)).trim();
    if (content.length < this.getSettings().renameMinContentChars) {
      new Notice(t().common.notice(t().ai.renameTooShort));
      return null;
    }

    return this.withBusy("rename", () => this.nameForNote(content, apiKey));
  }

  /** The model's name for a note's text, sanitized, or null with a notice. */
  private async nameForNote(content: string, apiKey: string): Promise<string | null> {
    const settings = this.getSettings();

    let proposed: string;
    try {
      proposed = await generateRenameFilename(
        content.slice(0, settings.renameMaxContentChars),
        settings,
        apiKey
      );
    } catch (err) {
      this.fail("rename", t().ai.failRename, err);
      return null;
    }

    return this.usableName(proposed, "md");
  }

  /** The model's name for a picture, sanitized, or null with a notice. */
  private async nameForImage(
    file: TFile,
    mimeType: string,
    apiKey: string
  ): Promise<string | null> {
    const settings = this.getSettings();
    const buffer = await this.app.vault.readBinary(file);

    let image: Awaited<ReturnType<typeof resizeImageToBase64>>;
    try {
      image = await resizeImageToBase64(buffer, mimeType, settings.renameMaxImagePx);
    } catch (err) {
      this.fail("image resize", t().ai.failImage, err);
      return null;
    }

    let proposed: string;
    try {
      // The type the canvas produced, not the one the file had: a GIF comes
      // back as PNG, and the model is told what it is actually being sent.
      proposed = await generateImageRenameFilename(image.base64, image.mimeType, settings, apiKey);
    } catch (err) {
      this.fail("image rename", t().ai.failRename, err);
      return null;
    }

    return this.usableName(proposed, file.extension);
  }

  /** What the model said, cut to a filename, or null once it has been reported. */
  private usableName(proposed: string, extension: string): string | null {
    const sanitized = stripFilenameExtension(
      sanitizeFilename(proposed, this.getSettings().renameMaxFilenameLength),
      extension
    );
    if (sanitized) return sanitized;

    this.logger.warn("Rename produced an unusable filename:", proposed);
    new Notice(t().common.notice(t().ai.renameFailedName));
    return null;
  }

  async summarizeSelection(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return;
    }

    const editor = view.editor;
    const selection = editor.getSelection();
    if (!selection.trim()) {
      new Notice(t().common.notice(t().ai.selectText));
      return;
    }

    const apiKey = this.requireApiKey();
    if (!apiKey) {
      return;
    }

    // Capture the exact range now, so the replacement targets the original
    // selection even if the cursor moves while the request is in flight.
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");

    await this.withBusy("summarize", async () => {
      const progress = new Notice(t().common.notice(t().ai.summarizing), 0);
      let summary: string;
      try {
        summary = await generateSummary(selection, this.getSettings(), apiKey);
      } catch (err) {
        this.fail("summarize", t().ai.failSummarize, err);
        return;
      } finally {
        progress.hide();
      }

      if (!summary) {
        this.logger.warn("Summarize returned an empty response.");
        new Notice(t().common.notice(t().ai.summarizeFailed));
        return;
      }

      editor.replaceRange(summary, from, to);
    });
  }

  private requireApiKey(): string | null {
    const result = resolveApiKey(
      this.app.secretStorage,
      this.getSettings().llmSecretName,
      "API key"
    );
    if (!result.ok) {
      new Notice(result.message);
      return null;
    }
    return result.apiKey;
  }

  /**
   * Run `work` under the in-flight guard, declining if a command is running.
   *
   * What the work returned comes back with it, and a declined run answers null:
   * the pane's menu needs the name, not only the fact that something happened.
   */
  private async withBusy<T>(label: string, work: () => Promise<T>): Promise<T | null> {
    if (this.busy) {
      this.logger.debug(`Ignoring ${label}: another AI command is already running.`);
      new Notice(t().common.notice(t().ai.busy));
      return null;
    }
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }

  private async renameFile(file: TFile, newPath: string): Promise<void> {
    try {
      await this.app.fileManager.renameFile(file, newPath);
      this.logger.debug("Renamed file to", newPath);
    } catch (err) {
      this.logger.warn("File rename failed for", newPath, err);
      new Notice(t().common.notice(t().ai.renameFailedExists));
    }
  }

  private fail(label: string, userMessage: string, err: unknown): void {
    this.logger.error(`${label} failed:`, err);
    const detail = err instanceof Error ? err.message : "unknown error";
    new Notice(`${userMessage} — ${detail}`);
  }
}
