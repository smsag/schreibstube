import { MarkdownView, Notice, normalizePath, type App, type Editor, type TFile } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { activeLocale, t } from "../i18n";
import { resolveApiKey } from "../services/secret";
import { MAX_IMAGE_BYTES, getImageMimeType, resizeImageToBase64 } from "../services/image-resize";
import {
  generateImageRenameFilename,
  generateRenameFilename,
  sanitizeFilename,
  stripFilenameExtension
} from "../services/llm-rename";
import { generateSummary } from "../services/llm-summarize";
import { generateImageDescription } from "../services/llm-describe";
import {
  descriptionNotePath,
  hashImageBytes,
  renderDescriptionNote,
  type DescriptionLanguage
} from "../services/image-description";
import { buildSummaryRequest, effectiveModel } from "../services/llm-providers";
import { sendRequest } from "../services/llm-client";
import {
  TABLE_MAX_INPUT_CHARS,
  TABLE_MAX_TOKENS,
  TABLE_SYSTEM_PROMPT,
  parseTableResponse
} from "../services/llm-table";
import type { MarkdownTable } from "../services/text-to-table";
import { insertTable, selectedLineRange } from "./table-insert";

/**
 * The LLM-backed commands (rename note, rename image, summarize selection,
 * table from selection). A single in-flight guard prevents overlapping API calls, and each
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

  /**
   * Describe a picture and keep the description as a note (image descriptions,
   * Epic A1).
   *
   * One note per picture in the shared folder, replaced in place when the
   * picture is described again. The picture is resized before it is sent — the
   * canvas that does it drops EXIF, GPS included — and fingerprinted from the
   * original bytes, so a later check can tell whether it changed.
   */
  async describeImage(file: TFile): Promise<void> {
    const settings = this.getSettings();
    if (!settings.imageDescriptionsEnabled) return;

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
    if (!apiKey) return;

    await this.withBusy("image description", async () => {
      let buffer: ArrayBuffer;
      let image: Awaited<ReturnType<typeof resizeImageToBase64>>;
      try {
        buffer = await this.app.vault.readBinary(file);
        image = await resizeImageToBase64(buffer, mimeType, settings.renameMaxImagePx);
      } catch (err) {
        this.fail("image resize", t().ai.failImage, err);
        return;
      }

      const language: DescriptionLanguage =
        settings.imageDescriptionLanguage === "auto"
          ? activeLocale()
          : settings.imageDescriptionLanguage;
      new Notice(t().common.notice(t().ai.describing));
      let description;
      try {
        description = await generateImageDescription(image, language, settings, apiKey);
      } catch (err) {
        this.fail("image description", t().ai.failDescribe, err);
        return;
      }
      if (!description) {
        new Notice(t().common.notice(t().ai.describeUnusable));
        return;
      }

      const note = renderDescriptionNote(
        {
          path: file.path,
          hash: hashImageBytes(new Uint8Array(buffer)),
          size: file.stat.size,
          describedAt: new Date().toISOString()
        },
        description,
        { keywordsAsTags: settings.imageDescriptionKeywordsAsTags, language }
      );
      const path = normalizePath(descriptionNotePath(settings.imageDescriptionFolder, file.path));
      try {
        await this.writeNote(path, note);
      } catch (err) {
        this.fail("image description", t().ai.failDescribe, err);
        return;
      }
      new Notice(t().common.notice(t().ai.described(description.title)));
    });
  }

  /** Create a note, or replace it in place so a link to it keeps working. */
  private async writeNote(path: string, content: string): Promise<void> {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const existing = this.app.vault.getFileByPath(path);
    if (existing) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(path, content);
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

    let image: Awaited<ReturnType<typeof resizeImageToBase64>>;
    try {
      // Inside the guard with the resize: a picture gone between the menu and
      // this read used to reject past every notice and leave "renaming…" as
      // the last word.
      const buffer = await this.app.vault.readBinary(file);
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

    // The range is captured now, so the replacement targets the original
    // selection even if the cursor moves while the request is in flight; and
    // checked again before writing, because an edit above the selection moves
    // the text out from under those coordinates.
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

      if (editor.getRange(from, to) !== selection) {
        new Notice(t().common.notice(t().ai.selectionMoved));
        return;
      }
      editor.replaceRange(summary, from, to);
    });
  }

  /**
   * Turn the selected lines into a table chosen by the model, for text a
   * plain split cannot read. Like the summary, the range is captured before
   * the request and compared again before anything is replaced.
   */
  async tableFromSelection(editor: Editor): Promise<void> {
    const range = selectedLineRange(editor);
    if (!range) {
      new Notice(t().common.notice(t().ai.tableSelectLines));
      return;
    }

    const original = editor.getRange(range.from, range.to);
    if (original.length > TABLE_MAX_INPUT_CHARS) {
      new Notice(t().common.notice(t().ai.tableTooLong(TABLE_MAX_INPUT_CHARS)));
      return;
    }

    const apiKey = this.requireApiKey();
    if (!apiKey) {
      return;
    }

    await this.withBusy("table", async () => {
      const settings = this.getSettings();
      const progress = new Notice(t().common.notice(t().ai.tableCreating), 0);
      let table: MarkdownTable | null;
      try {
        const request = buildSummaryRequest(
          settings.llmProvider,
          effectiveModel(settings),
          apiKey,
          TABLE_SYSTEM_PROMPT,
          original,
          TABLE_MAX_TOKENS
        );
        const raw = await sendRequest(settings.llmProvider, request);
        table = parseTableResponse(raw);
        if (!table) this.logger.warn("Table conversion returned no usable table:", raw);
      } catch (err) {
        this.fail("table", t().ai.failTable, err);
        return;
      } finally {
        progress.hide();
      }

      if (!table) {
        new Notice(t().common.notice(t().ai.tableFailedEmpty));
        return;
      }

      const unchanged =
        range.to.line <= editor.lastLine() && editor.getRange(range.from, range.to) === original;
      if (!unchanged) {
        new Notice(t().common.notice(t().ai.tableSelectionMoved));
        return;
      }
      insertTable(editor, range, table);
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
      // A collision is the likely reason, but not the only one: the file may
      // have been moved or deleted while the model was thinking, and blaming a
      // name that is free sends the person looking for a file that is not
      // there.
      const taken = this.app.vault.getAbstractFileByPath(newPath) !== null;
      new Notice(
        t().common.notice(
          taken
            ? t().ai.renameFailedExists
            : t().ai.renameFailed(err instanceof Error ? err.message : String(err))
        )
      );
    }
  }

  private fail(label: string, userMessage: string, err: unknown): void {
    this.logger.error(`${label} failed:`, err);
    const detail = err instanceof Error ? err.message : t().proofread.unknownError;
    new Notice(`${userMessage} — ${detail}`);
  }
}
