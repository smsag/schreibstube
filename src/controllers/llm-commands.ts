import { MarkdownView, Notice, normalizePath, type App, type TFile } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { resolveApiKey } from "../services/secret";
import {
  MAX_IMAGE_BYTES,
  getImageMimeType,
  resizeImageToBase64
} from "../services/image-resize";
import {
  generateImageRenameFilename,
  generateRenameFilename,
  sanitizeFilename
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
      const truncated = content.slice(0, settings.renameMaxContentChars);

      let proposed: string;
      try {
        proposed = await generateRenameFilename(truncated, settings, apiKey);
      } catch (err) {
        this.fail("rename", "Schreibstube: rename failed", err);
        return;
      }

      const sanitized = sanitizeFilename(proposed, settings.renameMaxFilenameLength);
      if (!sanitized) {
        this.logger.warn("Rename produced an unusable filename:", proposed);
        new Notice("Schreibstube: rename failed — the LLM returned an unusable filename.");
        return;
      }

      const folder = file.parent?.path ?? "";
      const newPath = normalizePath(`${folder}/${sanitized}.md`);
      await this.renameFile(file, newPath);
    });
  }

  async renameImageFromContent(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return;
    }

    const settings = this.getSettings();
    const mimeType = getImageMimeType(file.extension);
    if (!mimeType) {
      new Notice("Schreibstube: unsupported format — supported image types: jpg, png, gif, webp.");
      return;
    }

    if (file.stat.size > MAX_IMAGE_BYTES) {
      new Notice("Schreibstube: image exceeds the 10 MB limit.");
      return;
    }

    const apiKey = this.requireApiKey();
    if (!apiKey) {
      return;
    }

    await this.withBusy("image rename", async () => {
      const buffer = await this.app.vault.readBinary(file);

      let base64Image: string;
      try {
        base64Image = await resizeImageToBase64(buffer, mimeType, settings.renameMaxImagePx);
      } catch (err) {
        this.fail("image resize", "Schreibstube: could not process image", err);
        return;
      }

      let proposed: string;
      try {
        proposed = await generateImageRenameFilename(base64Image, mimeType, settings, apiKey);
      } catch (err) {
        this.fail("image rename", "Schreibstube: rename failed", err);
        return;
      }

      const sanitized = sanitizeFilename(proposed, settings.renameMaxFilenameLength);
      if (!sanitized) {
        this.logger.warn("Image rename produced an unusable filename:", proposed);
        new Notice("Schreibstube: rename failed — the LLM returned an unusable filename.");
        return;
      }

      const folder = file.parent?.path ?? "";
      const newPath = normalizePath(`${folder}/${sanitized}.${file.extension}`);
      await this.renameFile(file, newPath);
    });
  }

  async summarizeSelection(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return;
    }

    const editor = view.editor;
    const selection = editor.getSelection();
    if (!selection.trim()) {
      new Notice("Schreibstube: select some text to summarize first.");
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
      const progress = new Notice("Schreibstube: summarizing…", 0);
      let summary: string;
      try {
        summary = await generateSummary(selection, this.getSettings(), apiKey);
      } catch (err) {
        this.fail("summarize", "Schreibstube: summarize failed", err);
        return;
      } finally {
        progress.hide();
      }

      if (!summary) {
        this.logger.warn("Summarize returned an empty response.");
        new Notice("Schreibstube: summarize failed — the LLM returned an empty response.");
        return;
      }

      editor.replaceRange(summary, from, to);
    });
  }

  private requireApiKey(): string | null {
    const result = resolveApiKey(this.app.secretStorage, this.getSettings().llmSecretName);
    if (!result.ok) {
      new Notice(result.message);
      return null;
    }
    return result.apiKey;
  }

  /** Run `work` under the in-flight guard, declining if a command is running. */
  private async withBusy(label: string, work: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.logger.debug(`Ignoring ${label}: another AI command is already running.`);
      new Notice("Schreibstube: an AI command is already running — please wait.");
      return;
    }
    this.busy = true;
    try {
      await work();
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
      new Notice("Schreibstube: rename failed — a file with that name may already exist.");
    }
  }

  private fail(label: string, userMessage: string, err: unknown): void {
    this.logger.error(`${label} failed:`, err);
    const detail = err instanceof Error ? err.message : "unknown error";
    new Notice(`${userMessage} — ${detail}`);
  }
}
