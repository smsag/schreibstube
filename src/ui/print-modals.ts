/**
 * Which template to print with, when the note has not said.
 *
 * A suggester rather than a list of buttons: a vault may hold three templates
 * or thirty, and the one a person wants is the one they can type the first
 * letters of. The hint under it says how to stop being asked.
 */
import { SuggestModal, type App } from "obsidian";
import { t } from "../i18n";
import type { PrintTemplate } from "../services/print-template";

export class PrintTemplateModal extends SuggestModal<PrintTemplate> {
  private answered = false;

  constructor(
    app: App,
    private readonly templates: PrintTemplate[],
    private readonly onChoose: (template: PrintTemplate | null) => void
  ) {
    super(app);
    this.setPlaceholder(t().print.chooseTemplate);
  }

  override getSuggestions(query: string): PrintTemplate[] {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return this.templates;
    return this.templates.filter((template) => template.name.toLowerCase().includes(wanted));
  }

  override renderSuggestion(template: PrintTemplate, el: HTMLElement): void {
    el.createDiv({ text: template.name });
    el.createEl("small", { cls: "schreibstube-print-folder", text: template.folder });
  }

  override onChooseSuggestion(template: PrintTemplate): void {
    this.answered = true;
    this.onChoose(template);
  }

  /** A modal closed without a choice is a print that was called off, and the
   *  caller is waiting on an answer either way. */
  override onClose(): void {
    super.onClose();
    if (!this.answered) this.onChoose(null);
  }
}
