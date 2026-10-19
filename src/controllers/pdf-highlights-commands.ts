import { Notice, TFile, type App } from "obsidian";

import { activeLocale, t } from "../i18n";
import type { Logger } from "../services/logger";
import { collectExcerpts, marksWithoutText, runningText } from "../services/pdf-highlights";
import {
  composeHighlightNote,
  safeEmbed,
  templateNotePath,
  type HighlightNoteParts
} from "../services/highlight-note";
import { newNotePath } from "../services/new-note";
import { formatDate } from "../services/today-value";
import { hasTemplaterCode } from "../services/property-sets";
import {
  coreTemplateFormats,
  templaterCreator,
  type TemplaterCreate
} from "../services/workspace-internals";
import type { SchreibstubeSettings } from "../types";
import { withTimeout } from "../utils/with-timeout";
import type { MarkedReadResult } from "../pdf/pdf-reader";

export type PdfMarksReader = (data: ArrayBuffer) => Promise<MarkedReadResult>;

/** A template may ask the person something (`tp.system.prompt`); this is the
 *  ceiling on that, not on Templater's own work. */
const TEMPLATER_TIMEOUT_MS = 120_000;

interface Template {
  file: TFile;
  text: string;
}

/**
 * The text marked in a PDF, written into a new note.
 *
 * The command runs on the PDF in front. It reads the text that is both
 * highlighted in yellow and underlined (`services/pdf-highlights` decides
 * what that covers), makes a note from the person's template in the folder
 * Obsidian puts new notes in, and opens it.
 *
 * A template without Templater code gives a note written once, whole: an
 * empty note would be filled by Templater's folder templates if the person
 * has them, and race this command doing the same. A template with code is
 * made into the note by Templater, which keeps its own trigger away while it
 * works, and the excerpt goes in after. Every way this can fail ends in a
 * notice that names it, and none leaves an empty note behind.
 */
export class PdfHighlightCommands {
  private readonly createWithTemplater: (app: App) => TemplaterCreate | null;

  constructor(
    private readonly app: App,
    private readonly logger: Logger,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly readMarks: PdfMarksReader,
    createWithTemplater?: (app: App) => TemplaterCreate | null
  ) {
    this.createWithTemplater = createWithTemplater ?? templaterCreator;
  }

  async highlightsToNote(pdf: TFile): Promise<void> {
    let result: MarkedReadResult;
    try {
      result = await this.readMarks(await this.app.vault.readBinary(pdf));
    } catch (error) {
      this.logger.warn(`Could not read ${pdf.path}:`, error);
      new Notice(t().common.notice(t().pdf.unreadable(pdf.basename)));
      return;
    }

    const excerpts = collectExcerpts(result.pages);
    if (excerpts.length === 0) {
      const scan = marksWithoutText(result.pages);
      new Notice(
        t().common.notice(
          scan ? t().pdf.marksWithoutText(pdf.basename) : t().pdf.noMarks(pdf.basename)
        )
      );
      return;
    }
    if (result.truncated) {
      new Notice(t().common.notice(t().pdf.truncated(result.pages.length, result.totalPages)));
    }

    const folder = this.app.fileManager.getNewFileParent(pdf.path, `${pdf.basename}.md`).path;
    const template = await this.template();
    const fill = (text: string | null, notePath: string, title: string): string =>
      composeHighlightNote(text, this.parts(pdf, runningText(excerpts), notePath, title));

    const note =
      template && hasTemplaterCode(template.text)
        ? await this.withTemplater(template, folder, pdf.basename, fill)
        : await this.whole(template?.text ?? null, folder, pdf.basename, fill);
    if (!note) return;

    try {
      await this.app.workspace.getLeaf("tab").openFile(note);
    } catch (error) {
      // The note is there and says so below; only showing it failed.
      this.logger.warn(`Could not open ${note.path}:`, error);
    }
    new Notice(t().common.notice(t().pdf.highlightsCreated(excerpts.length, note.basename)));
  }

  private parts(pdf: TFile, excerpt: string, notePath: string, title: string): HighlightNoteParts {
    const formats = coreTemplateFormats(this.app);
    const now = new Date();
    return {
      excerpt,
      pdfEmbed: safeEmbed(`!${this.app.fileManager.generateMarkdownLink(pdf, notePath)}`, pdf.name),
      title,
      formatNow: (format) => formatDate(now, format, activeLocale()),
      dateFormat: formats.date,
      timeFormat: formats.time
    };
  }

  /** The note written in one go, from a template without code or from none. */
  private async whole(
    template: string | null,
    folder: string,
    base: string,
    fill: (text: string | null, notePath: string, title: string) => string
  ): Promise<TFile | null> {
    const path = newNotePath(
      folder,
      base,
      (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null
    );
    const title = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    try {
      return await this.app.vault.create(path, fill(template, path, title));
    } catch (error) {
      this.logger.warn(`Could not create ${path}:`, error);
      new Notice(t().common.notice(t().pdf.createFailed(path)));
      return null;
    }
  }

  /**
   * The note made by Templater from the template, then filled. Templater
   * renders the template alone; the PDF's text is put in afterwards, so it
   * is never in front of Templater as code.
   */
  private async withTemplater(
    template: Template,
    folder: string,
    base: string,
    fill: (text: string | null, notePath: string, title: string) => string
  ): Promise<TFile | null> {
    const create = this.createWithTemplater(this.app);
    if (!create) {
      new Notice(t().common.notice(t().pdf.templaterMissing));
      return this.whole(template.text, folder, base, fill);
    }

    let note: TFile | null;
    try {
      note = await withTimeout(
        create(template.file, folder, base),
        TEMPLATER_TIMEOUT_MS,
        (seconds) => `no answer after ${seconds} s`
      );
    } catch (error) {
      this.logger.warn(`Templater could not make a note from ${template.file.path}:`, error);
      const reason = error instanceof Error ? error.message : String(error);
      new Notice(t().common.notice(t().pdf.templaterFailed(reason)));
      return null;
    }
    if (!note) {
      // Templater has said why, and removed the note it started.
      new Notice(t().common.notice(t().pdf.templaterNoNote(template.file.path)));
      return null;
    }

    try {
      const rendered = await this.app.vault.read(note);
      await this.app.vault.modify(note, fill(rendered, note.path, note.basename));
      return note;
    } catch (error) {
      this.logger.warn(`Could not fill ${note.path}:`, error);
      new Notice(t().common.notice(t().pdf.fillFailed(note.path)));
      return null;
    }
  }

  /** The template named in the settings and its text, or null for none. */
  private async template(): Promise<Template | null> {
    const path = templateNotePath(this.getSettings().pdfHighlightsTemplate);
    if (path === "") return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t().common.notice(t().pdf.templateMissing(path)));
      return null;
    }
    try {
      return { file, text: await this.app.vault.cachedRead(file) };
    } catch (error) {
      // Gone between the look and the read, or unreadable: the same as missing.
      this.logger.warn(`Could not read the template ${path}:`, error);
      new Notice(t().common.notice(t().pdf.templateMissing(path)));
      return null;
    }
  }
}
