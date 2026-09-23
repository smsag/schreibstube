import { type App, type Editor, Notice, SuggestModal, type TFile } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import { collectPassages } from "../services/pdf-passages";
import type { PdfPassage } from "../services/pdf-passages";
import { composePassageInsert } from "../services/pdf-insert";
import { pdfReferences } from "../services/pdf-references";
import { pdfSubpath } from "../services/pdf-anchor";
import { PdfPassagesModal } from "../ui/pdf-passages-modal";
import type { ReadResult } from "../pdf/pdf-reader";

/** Injected so the flow can be tested without pdf.js, which needs a real PDF. */
export type PdfTextReader = (data: ArrayBuffer) => Promise<ReadResult>;

/**
 * Shows the passages and reports back what was chosen.
 *
 * Injected for the same reason as the reader: the choosing is a modal, and a
 * test that had to open one would be testing Obsidian rather than this flow.
 */
export type PassagePicker = (
  passages: PdfPassage[],
  pdfName: string,
  onSubmit: (chosen: PdfPassage[]) => void
) => void;

/**
 * Summarising an attached PDF into the note, with a way back into it.
 *
 * The command reads the PDF the note already points at, offers its passages,
 * and writes the chosen ones at the cursor — each followed by a link that
 * opens the PDF at the page it came from. The link is built by Obsidian's own
 * `generateMarkdownLink`, so a vault set to Markdown links gets Markdown
 * links, and one set to wikilinks gets those.
 *
 * Every way this can fail ends in a notice that says which one it was. A PDF
 * with no text layer is the common case — a scan is still a picture to
 * anything that reads text — and it is worth saying so plainly rather than
 * opening an empty list.
 */
export class PdfCommands {
  private readonly pick: PassagePicker;

  constructor(
    private readonly app: App,
    private readonly logger: Logger,
    private readonly readPdf: PdfTextReader,
    pick?: PassagePicker
  ) {
    this.pick =
      pick ??
      ((passages, pdfName, onSubmit) =>
        new PdfPassagesModal(this.app, passages, pdfName, onSubmit).open());
  }

  /** The PDFs the active note points at, resolved against the vault. */
  referencedPdfs(source: TFile): TFile[] {
    const cache = this.app.metadataCache.getFileCache(source);
    const linkPaths = pdfReferences({
      embeds: (cache?.embeds ?? []).map((embed) => embed.link),
      links: (cache?.links ?? []).map((link) => link.link)
    });

    const files: TFile[] = [];
    for (const linkPath of linkPaths) {
      const file = this.app.metadataCache.getFirstLinkpathDest(linkPath, source.path);
      // A link can name a file that is not there; the note says so, the vault
      // disagrees, and the vault is right.
      if (file) files.push(file);
    }
    return files;
  }

  async insertSummary(editor: Editor): Promise<void> {
    const source = this.app.workspace.getActiveFile();
    if (!source) return;

    const pdfs = this.referencedPdfs(source);
    if (pdfs.length === 0) {
      new Notice(t().common.notice(t().pdf.noneAttached));
      return;
    }

    const pdf = pdfs.length === 1 ? pdfs[0] : await this.choosePdf(pdfs);
    if (!pdf) return;

    await this.summarise(editor, source, pdf);
  }

  private async summarise(editor: Editor, source: TFile, pdf: TFile): Promise<void> {
    let result: ReadResult;
    try {
      result = await this.readPdf(await this.app.vault.readBinary(pdf));
    } catch (error) {
      // A password, a truncated download, a file that is not a PDF at all:
      // pdf.js distinguishes these and we do not, because the answer is the
      // same either way — this file cannot be read here.
      this.logger.warn(`Could not read ${pdf.path}:`, error);
      new Notice(t().common.notice(t().pdf.unreadable(pdf.basename)));
      return;
    }

    const passages = collectPassages(result.pages);
    if (passages.length === 0) {
      new Notice(t().common.notice(t().pdf.noTextLayer(pdf.basename)));
      return;
    }
    if (result.truncated) {
      new Notice(t().common.notice(t().pdf.truncated(result.pages.length, result.totalPages)));
    }

    this.pick(passages, pdf.basename, (chosen) => {
      this.insert(editor, source, pdf, chosen);
    });
  }

  private insert(editor: Editor, source: TFile, pdf: TFile, chosen: PdfPassage[]): void {
    const markdown = composePassageInsert(chosen, (passage) =>
      this.app.fileManager.generateMarkdownLink(
        pdf,
        source.path,
        `#${pdfSubpath(passage.anchor)}`,
        t().pdf.markLabel
      )
    );
    if (markdown === "") return;

    editor.replaceSelection(markdown);
    new Notice(t().common.notice(t().pdf.inserted(chosen.length)));
  }

  private choosePdf(pdfs: TFile[]): Promise<TFile | null> {
    return new Promise((resolve) => new PdfChooser(this.app, pdfs, resolve).open());
  }
}

/** Which PDF, when the note points at more than one. */
class PdfChooser extends SuggestModal<TFile> {
  private answered = false;

  constructor(
    app: App,
    private readonly pdfs: TFile[],
    private readonly resolve: (file: TFile | null) => void
  ) {
    super(app);
    this.setPlaceholder(t().pdf.choosePdf);
  }

  getSuggestions(query: string): TFile[] {
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? this.pdfs
      : this.pdfs.filter((file) => file.path.toLowerCase().includes(needle));
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createDiv({ text: file.basename });
    el.createEl("small", { text: file.path });
  }

  onChooseSuggestion(file: TFile): void {
    this.answered = true;
    this.resolve(file);
  }

  override onClose(): void {
    // Dismissing the chooser is an answer too, and a promise nobody settles
    // would leave the command half-run for the rest of the session.
    if (!this.answered) this.resolve(null);
  }
}
