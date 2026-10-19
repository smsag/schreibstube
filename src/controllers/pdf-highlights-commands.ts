import { Notice, TFile, type App } from "obsidian";

import { activeLocale, t } from "../i18n";
import type { Logger } from "../services/logger";
import { collectExcerpts, marksWithoutText, runningText } from "../services/pdf-highlights";
import {
  composeHighlightNote,
  fillCoreVariables,
  templateNotePath
} from "../services/highlight-note";
import { newNotePath } from "../services/new-note";
import { hasTemplaterCode } from "../services/property-sets";
import { templaterRenderer, type TemplaterRender } from "../services/workspace-internals";
import type { SchreibstubeSettings } from "../types";
import { withTimeout } from "../utils/with-timeout";
import type { MarkedReadResult } from "../pdf/pdf-reader";

export type PdfMarksReader = (data: ArrayBuffer) => Promise<MarkedReadResult>;

/** A template may ask the person something (`tp.system.prompt`); this is the
 *  ceiling on that, not on Templater's own work. */
const TEMPLATER_TIMEOUT_MS = 120_000;

/**
 * The text marked in a PDF, written into a new note.
 *
 * The command runs on the PDF in front. It reads the text that is both
 * highlighted in yellow and underlined (`services/pdf-highlights` decides
 * what that covers), makes a note from the person's template in the folder
 * Obsidian puts new notes in, and opens it. Every way this can fail ends in a
 * notice that names it; a template that is missing or a Templater that fails
 * still gives the note, since the text is what was asked for.
 */
export class PdfHighlightCommands {
  private readonly renderTemplater: (app: App) => TemplaterRender | null;

  constructor(
    private readonly app: App,
    private readonly logger: Logger,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly readMarks: PdfMarksReader,
    renderTemplater?: (app: App) => TemplaterRender | null
  ) {
    this.renderTemplater = renderTemplater ?? templaterRenderer;
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

    const folder = this.app.fileManager.getNewFileParent(pdf.path, `${pdf.basename}.md`);
    const path = newNotePath(
      folder.path,
      pdf.basename,
      (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null
    );

    let note: TFile;
    try {
      // Made empty first: Templater fills a template for a file that exists.
      note = await this.app.vault.create(path, "");
    } catch (error) {
      this.logger.warn(`Could not create ${path}:`, error);
      new Notice(t().common.notice(t().pdf.createFailed(path)));
      return;
    }

    const template = await this.template(note);
    const pdfEmbed = `!${this.app.fileManager.generateMarkdownLink(pdf, note.path)}`;
    await this.app.vault.modify(
      note,
      composeHighlightNote(template, { excerpt: runningText(excerpts), pdfEmbed })
    );

    await this.app.workspace.getLeaf("tab").openFile(note);
    new Notice(t().common.notice(t().pdf.highlightsCreated(excerpts.length, note.basename)));
  }

  /**
   * The template's text, its variables filled, or null for none. Templater
   * runs here, on the template alone: the PDF's text goes in afterwards, so
   * nothing a PDF says is ever read as code.
   */
  private async template(note: TFile): Promise<string | null> {
    const path = templateNotePath(this.getSettings().pdfHighlightsTemplate);
    if (path === "") return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t().common.notice(t().pdf.templateMissing(path)));
      return null;
    }

    const text = fillCoreVariables(await this.app.vault.cachedRead(file), {
      title: note.basename,
      now: new Date(),
      locale: activeLocale()
    });
    if (!hasTemplaterCode(text)) return text;

    const render = this.renderTemplater(this.app);
    if (!render) {
      new Notice(t().common.notice(t().pdf.templaterMissing));
      return text;
    }
    try {
      return await withTimeout(
        render(file, note, text),
        TEMPLATER_TIMEOUT_MS,
        (seconds) => `no answer after ${seconds} s`
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Templater could not render ${file.path}: ${reason}`);
      new Notice(t().common.notice(t().pdf.templaterFailed(reason)));
      return text;
    }
  }
}
