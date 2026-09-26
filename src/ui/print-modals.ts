import { SuggestModal, type App } from "obsidian";
import { t } from "../i18n";
import type { ExampleTemplate } from "../services/print-examples";

/**
 * Which example template to lay down in the vault.
 *
 * A suggester rather than a list of buttons: the one a person wants is the one
 * they can type the first letters of.
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
