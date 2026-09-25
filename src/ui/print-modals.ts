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
import type { ExampleTemplate } from "../services/print-examples";

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
    el.createEl("small", {
      cls: "schreibstube-print-folder",
      text: template.builtIn ? t().print.builtIn : template.folder
    });
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

/**
 * Which example template to lay down in the vault.
 *
 * The same shape as choosing one to print with, because it is the same
 * question asked a step earlier, and a person who has met one list should not
 * have to learn a second.
 */
export class PrintExampleModal extends SuggestModal<ExampleTemplate> {
  private answered = false;

  constructor(
    app: App,
    private readonly examples: readonly ExampleTemplate[],
    private readonly onChoose: (example: ExampleTemplate | null) => void
  ) {
    super(app);
    this.setPlaceholder(t().print.chooseExample);
  }

  override getSuggestions(query: string): ExampleTemplate[] {
    const wanted = query.trim().toLowerCase();
    const all = [...this.examples];
    if (!wanted) return all;
    return all.filter((example) => example.name.toLowerCase().includes(wanted));
  }

  override renderSuggestion(example: ExampleTemplate, el: HTMLElement): void {
    el.createDiv({ text: example.name });
    el.createEl("small", {
      cls: "schreibstube-print-folder",
      text: example.files.map((file) => file.name).join(", ")
    });
  }

  override onChooseSuggestion(example: ExampleTemplate): void {
    this.answered = true;
    this.onChoose(example);
  }

  override onClose(): void {
    super.onClose();
    if (!this.answered) this.onChoose(null);
  }
}
