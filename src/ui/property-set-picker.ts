/**
 * Which property set a note should get: Schreibstube's own first, then the
 * sets from the folder, each with where it comes from.
 */
import { App, SuggestModal } from "obsidian";

export interface SetChoice {
  id: string;
  name: string;
  /** "Schreibstube", or the set note's path. */
  origin: string;
  /** The keys it would add, for a person to recognise the set by. */
  keys: string[];
}

export class PropertySetPickerModal extends SuggestModal<SetChoice> {
  constructor(
    app: App,
    private readonly choices: readonly SetChoice[],
    placeholder: string,
    private readonly onChoose: (choice: SetChoice) => void
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getSuggestions(query: string): SetChoice[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [...this.choices];
    return this.choices.filter(
      (choice) =>
        choice.name.toLowerCase().includes(needle) ||
        choice.keys.some((key) => key.toLowerCase().includes(needle))
    );
  }

  renderSuggestion(choice: SetChoice, el: HTMLElement): void {
    el.createDiv({ text: choice.name });
    el.createEl("small", {
      cls: "schreibstube-set-suggestion-detail",
      text: `${choice.origin} · ${choice.keys.join(", ")}`
    });
  }

  onChooseSuggestion(choice: SetChoice): void {
    this.onChoose(choice);
  }
}
