/**
 * Which term a word should be avoided for: the notes in the term folder, by
 * term. Reached from the review panel's "Add rule".
 */
import { App, SuggestModal } from "obsidian";
import type { TermNoteEntry } from "../platform/glossary-registry";

export class TermPickerModal extends SuggestModal<TermNoteEntry> {
  constructor(
    app: App,
    private readonly terms: readonly TermNoteEntry[],
    placeholder: string,
    private readonly onChoose: (entry: TermNoteEntry) => void
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getSuggestions(query: string): TermNoteEntry[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [...this.terms];
    return this.terms.filter((entry) => entry.term.toLowerCase().includes(needle));
  }

  renderSuggestion(entry: TermNoteEntry, el: HTMLElement): void {
    el.createDiv({ text: entry.term });
    el.createEl("small", { cls: "schreibstube-review-hint", text: entry.path });
  }

  onChooseSuggestion(entry: TermNoteEntry): void {
    this.onChoose(entry);
  }
}
