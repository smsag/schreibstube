import { SuggestModal, type App } from "obsidian";
import { t } from "../i18n";
import type { ExampleTemplate } from "../services/print-examples";
import { modalAnswer, type ModalAnswer } from "../services/modal-answer";

/**
 * Which example template to lay down in the vault.
 *
 * A suggester rather than a list of buttons: the one a person wants is the one
 * they can type the first letters of.
 */
export class PrintExampleModal extends SuggestModal<ExampleTemplate> {
  private readonly answer: ModalAnswer<ExampleTemplate | null>;

  constructor(
    app: App,
    private readonly examples: readonly ExampleTemplate[],
    onChoose: (example: ExampleTemplate | null) => void
  ) {
    super(app);
    this.answer = modalAnswer(onChoose);
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
    this.answer.choose(example);
  }

  override onClose(): void {
    super.onClose();
    // Obsidian closes the list before it reports the pick; see modal-answer.
    this.answer.closed(null);
  }
}
