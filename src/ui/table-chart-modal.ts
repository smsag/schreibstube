/**
 * The charts a table offers, drawn, with a button each.
 *
 * Nothing is written until a button is pressed: the drawing is the question,
 * the block in the note the answer. The drawings are Obsidian's own, from the
 * same Mermaid block that would go into the note, so what is shown is what
 * the note will show.
 */
import { App, Component, MarkdownRenderer, Modal, Setting } from "obsidian";
import { t } from "../i18n";
import { chartBlock, type ChartSuggestion } from "../services/table-chart";

export class TableChartModal extends Modal {
  private readonly drawings = new Component();

  constructor(
    app: App,
    private readonly sourcePath: string,
    private readonly suggestions: readonly ChartSuggestion[],
    private readonly replaces: boolean,
    private readonly choose: (suggestion: ChartSuggestion) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const labels = t().chart;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("schreibstube-table-chart");
    this.setTitle(labels.title);
    this.drawings.load();

    contentEl.createEl("p", { text: labels.intro, cls: "setting-item-description" });
    if (this.replaces) {
      contentEl.createEl("p", { text: labels.replaces, cls: "setting-item-description" });
    }

    this.suggestions.forEach((suggestion, index) => {
      const option = contentEl.createDiv({ cls: "schreibstube-table-chart-option" });
      new Setting(option)
        .setName(labels.kinds[suggestion.kind])
        .setDesc(suggestion.title)
        .addButton((button) => {
          button.setButtonText(labels.insert).onClick(() => {
            this.close();
            this.choose(suggestion);
          });
          if (index === 0) button.setCta();
        });
      const drawing = option.createDiv({ cls: "schreibstube-table-chart-drawing" });
      void MarkdownRenderer.render(
        this.app,
        chartBlock(suggestion),
        drawing,
        this.sourcePath,
        this.drawings
      );
    });

    new Setting(contentEl).addButton((button) =>
      button.setButtonText(t().common.cancel).onClick(() => this.close())
    );
  }

  override onClose(): void {
    this.drawings.unload();
    this.contentEl.empty();
  }
}
