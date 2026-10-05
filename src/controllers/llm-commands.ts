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
} from "../platform/llm-rename";
import { generateSummary } from "../platform/llm-summarize";
import { generateImageDescription } from "../platform/llm-describe";
import {
  DESCRIPTION_KEYS,
  descriptionNotePath,
  hashImageBytes,
  keepForeignFrontmatter,
  renderDescriptionNote,
  type DescriptionLanguage
} from "../services/image-description";
import { isFavorite } from "../services/picture-embed-actions";
import { carriedArticleLinks } from "../services/picture-articles";
import { buildSummaryRequest, effectiveModel } from "../services/llm-providers";
import { sendRequest } from "../platform/llm-client";
import {
  TABLE_MAX_INPUT_CHARS,
  TABLE_MAX_TOKENS,
  TABLE_SYSTEM_PROMPT,
  guardTableCode,
  parseTableResponse
} from "../services/llm-table";
import { neutralizeIntroducedCode } from "../services/foreign-text";
import type { MarkdownTable } from "../services/text-to-table";
import {
  TAGS_MAX_TOKENS,
  parseTagsResponse,
  tagsSystemPrompt,
  tagsUserMessage
} from "../services/llm-tags";

import { insertTable, selectedLineRange } from "./table-insert";
import { missingAncestors, folderOfPath } from "../services/ensure-folder";

type DescribeOutcome =
  | { kind: "described"; title: string }
  | { kind: "unusable" }
  | { kind: "failed"; label: string; message: string; error: unknown };

/**
 * The LLM-backed commands. Each failure logs the underlying error before
 * showing a short Notice, so "it didn't work" reports are diagnosable from
 * the console.
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
      new Notice(t().common.notice(t().ai.renameTooShort));
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

  /** Describe one picture, from a command or its menu, and say what happened. */
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
      new Notice(t().common.notice(t().ai.describing));
      const outcome = await this.describeOne(file, mimeType, apiKey);
      if (outcome.kind === "described") {
        new Notice(t().common.notice(t().ai.described(outcome.title)));
      } else if (outcome.kind === "unusable") {
        new Notice(t().common.notice(t().ai.describeUnusable));
      } else {
        this.fail(outcome.label, outcome.message, outcome.error);
      }
    });
  }

  /**
   * Describe several pictures, one after another, as one AI command.
   *
   * One at a time: a provider's rate limit is per key, and a folder of a
   * hundred pictures sent at once is a hundred requests refused together.
   * Every picture is told apart in the tally rather than in a notice of its
   * own, and a failure is logged and counted, never the end of the run: the
   * next picture may well go through. Null when nothing ran — descriptions
   * off, no key, or another AI command busy — each of which has said so.
   */
  async describeImages(
    files: readonly TFile[],
    progress: (done: number, total: number) => void,
    stopped: () => boolean
  ): Promise<{ described: number; unusable: number; failed: number; stopped: boolean } | null> {
    if (!this.getSettings().imageDescriptionsEnabled) return null;
    const apiKey = this.requireApiKey();
    if (!apiKey) return null;

    return this.withBusy("folder descriptions", async () => {
      const tally = { described: 0, unusable: 0, failed: 0, stopped: false };
      for (const [index, file] of files.entries()) {
        if (stopped()) {
          tally.stopped = true;
          break;
        }
        progress(index, files.length);
        const mimeType = getImageMimeType(file.extension);
        if (!mimeType || file.stat.size > MAX_IMAGE_BYTES) {
          tally.failed++;
          continue;
        }
        const outcome = await this.describeOne(file, mimeType, apiKey);
        if (outcome.kind === "described") tally.described++;
        else if (outcome.kind === "unusable") tally.unusable++;
        else {
          tally.failed++;
          this.logger.warn(`Describing ${file.path} failed:`, outcome.error);
        }
      }
      if (!tally.stopped) progress(files.length, files.length);
      return tally;
    });
  }

  /**
   * Describe one picture and keep the description as a note (image
   * descriptions, Epic A1). What happened is returned, not announced: a single
   * picture says it in a notice, a folder in its tally.
   *
   * One note per picture in the shared folder, replaced in place when the
   * picture is described again. The picture is resized before it is sent — the
   * canvas that does it drops EXIF, GPS included — and fingerprinted from the
   * original bytes, so a later check can tell whether it changed.
   */
  private async describeOne(
    file: TFile,
    mimeType: string,
    apiKey: string
  ): Promise<DescribeOutcome> {
    const settings = this.getSettings();
    let buffer: ArrayBuffer;
    let image: Awaited<ReturnType<typeof resizeImageToBase64>>;
    try {
      buffer = await this.app.vault.readBinary(file);
      image = await resizeImageToBase64(buffer, mimeType, settings.renameMaxImagePx);
    } catch (error) {
      return { kind: "failed", label: "image resize", message: t().ai.failImage, error };
    }

    const language: DescriptionLanguage =
      settings.imageDescriptionLanguage === "auto"
        ? activeLocale()
        : settings.imageDescriptionLanguage;
    let description;
    try {
      description = await generateImageDescription(image, language, settings, apiKey);
    } catch (error) {
      return { kind: "failed", label: "image description", message: t().ai.failDescribe, error };
    }
    if (!description) return { kind: "unusable" };

    const path = normalizePath(descriptionNotePath(settings.imageDescriptionFolder, file.path));
    const favorite = this.favoriteOf(path);
    const articles = this.articlesOf(path);
    const note = renderDescriptionNote(
      {
        path: file.path,
        hash: hashImageBytes(new Uint8Array(buffer)),
        size: file.stat.size,
        describedAt: new Date().toISOString()
      },
      description,
      {
        keywordsAsTags: settings.imageDescriptionKeywordsAsTags,
        language,
        ...(favorite !== undefined ? { favorite } : {}),
        ...(articles !== undefined ? { articles } : {})
      }
    );
    try {
      await this.writeNote(path, note);
    } catch (error) {
      return { kind: "failed", label: "image description", message: t().ai.failDescribe, error };
    }
    return { kind: "described", title: description.title };
  }

  /** The star on the note a new description replaces: the person's, so it stays. */
  private favoriteOf(path: string): boolean | undefined {
    const existing = this.app.vault.getFileByPath(path);
    const frontmatter = existing
      ? this.app.metadataCache.getFileCache(existing)?.frontmatter
      : undefined;
    if (!frontmatter || !(DESCRIPTION_KEYS.favorite in frontmatter)) return undefined;
    return isFavorite(frontmatter[DESCRIPTION_KEYS.favorite]);
  }

  /** The article links on the note a new description replaces, kept until the next pass. */
  private articlesOf(path: string): string[] | undefined {
    const existing = this.app.vault.getFileByPath(path);
    const frontmatter = existing
      ? this.app.metadataCache.getFileCache(existing)?.frontmatter
      : undefined;
    return frontmatter ? carriedArticleLinks(frontmatter[DESCRIPTION_KEYS.articles]) : undefined;
  }

  /**
   * Create a note, or replace it in place so a link to it keeps working. The
   * old note is read in the same step it is replaced, so a property someone
   * added a moment ago is kept, not overwritten by a copy read earlier.
   */
  private async writeNote(path: string, content: string): Promise<void> {
    const exists = (folder: string): boolean =>
      this.app.vault.getAbstractFileByPath(folder) !== null;
    for (const folder of missingAncestors(folderOfPath(path), exists)) {
      await this.app.vault.createFolder(folder);
    }
    const existing = this.app.vault.getFileByPath(path);

    if (existing)
      await this.app.vault.process(existing, (old) => keepForeignFrontmatter(old, content));
    else await this.app.vault.create(path, content);
  }

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
      // The answer is the model's, and the model read text that may hold
      // instructions of somebody else's; code it adds must not run unread.
      const guarded = neutralizeIntroducedCode(selection, summary);
      editor.replaceRange(guarded.text, from, to);
      if (guarded.kinds.length > 0) {
        new Notice(t().common.notice(t().ai.codeNeutralized(guarded.kinds)), 0);
      }
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
      const guarded = guardTableCode(table, original);
      insertTable(editor, range, guarded.table);
      if (guarded.kinds.length > 0) {
        new Notice(t().common.notice(t().ai.codeNeutralized(guarded.kinds)), 0);
      }
    });
  }

  /**
   * Tags for a note from the model, asked in the vault's words.
   *
   * Only ever on a person's press in the tag dialog: this is the one source of
   * suggestions that sends the note's text away. Null when nothing was asked
   * — no key, another AI command running, the request failed — each of which
   * has said so; an empty list when the model answered with nothing usable.
   */
  async suggestTags(content: string, vocabulary: readonly string[]): Promise<string[] | null> {
    const apiKey = this.requireApiKey();
    if (!apiKey) return null;

    return this.withBusy("tag suggestions", async () => {
      const settings = this.getSettings();
      try {
        const request = buildSummaryRequest(
          settings.llmProvider,
          effectiveModel(settings),
          apiKey,
          tagsSystemPrompt(vocabulary),
          tagsUserMessage(content),
          TAGS_MAX_TOKENS
        );
        const raw = await sendRequest(settings.llmProvider, request);
        const tags = parseTagsResponse(raw);
        if (tags.length === 0) this.logger.warn("Tag suggestions returned no usable tags:", raw);
        return tags;
      } catch (err) {
        this.fail("tag suggestions", t().ai.failTags, err);
        return null;
      }
    });
  }

  private requireApiKey(): string | null {
    const result = resolveApiKey(
      this.app.secretStorage,
      this.getSettings().llmSecretName,
      t().secrets.apiKey
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
