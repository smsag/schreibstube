import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";
import type { PdfPassage } from "../services/pdf-passages";

/**
 * Choosing which passages of a PDF go into the note.
 *
 * The list is the document in order, page by page, because that is the order
 * a person read it in and the order the summary will come out in. Each row is
 * a checkbox and the passage itself — not a truncated preview, since deciding
 * whether a paragraph belongs in a summary means reading the paragraph.
 *
 * A report runs to hundreds of passages, so there is a filter. It hides rows
 * rather than forgetting them: a passage ticked before the filter was typed
 * is still ticked, and still inserted, which is why the tick is held in a set
 * keyed by the passage rather than read off the checkboxes at the end.
 */
export class PdfPassagesModal extends Modal {
  private readonly chosen = new Set<PdfPassage>();
  private rows: { element: HTMLElement; haystack: string }[] = [];
  private countEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly passages: PdfPassage[],
    private readonly pdfName: string,
    private readonly onSubmit: (chosen: PdfPassage[]) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("schreibstube-pdf-modal");
    contentEl.createEl("h3", { text: t().pdf.pickTitle(this.pdfName) });

    new Setting(contentEl).setName(t().pdf.filter).addText((text) => {
      text.setPlaceholder(t().pdf.filterPlaceholder).onChange((value) => this.applyFilter(value));
      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    const list = contentEl.createDiv({ cls: "schreibstube-pdf-list" });
    for (const passage of this.passages) {
      this.addRow(list, passage);
    }

    this.countEl = contentEl.createDiv({ cls: "schreibstube-pdf-count" });
    this.updateCount();

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(t().pdf.insert)
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((button) => button.setButtonText(t().common.cancel).onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private addRow(parent: HTMLElement, passage: PdfPassage): void {
    const row = parent.createDiv({ cls: "schreibstube-pdf-row" });
    const label = row.createEl("label", { cls: "schreibstube-pdf-label" });

    const box = label.createEl("input", { cls: "schreibstube-pdf-check" });
    box.type = "checkbox";
    box.addEventListener("change", () => {
      if (box.checked) this.chosen.add(passage);
      else this.chosen.delete(passage);
      this.updateCount();
    });

    const body = label.createDiv({ cls: "schreibstube-pdf-body" });
    body.createSpan({ cls: "schreibstube-pdf-page", text: t().pdf.pageLabel(passage.page) });
    body.createSpan({ cls: "schreibstube-pdf-text", text: passage.text });

    this.rows.push({ element: row, haystack: passage.text.toLowerCase() });
  }

  private applyFilter(query: string): void {
    const needle = query.trim().toLowerCase();
    for (const row of this.rows) {
      const hidden = needle !== "" && !row.haystack.includes(needle);
      row.element.toggleClass("schreibstube-pdf-hidden", hidden);
    }
  }

  private updateCount(): void {
    this.countEl?.setText(t().pdf.chosenCount(this.chosen.size));
  }

  private submit(): void {
    // Document order is restored when the Markdown is composed, so the set's
    // own order never reaches the note.
    const chosen = [...this.chosen];
    this.close();
    this.onSubmit(chosen);
  }
}
