/**
 * The tags a note could carry, to be ticked and added in one go.
 *
 * One section per source, because the sources are trusted differently and a
 * person should see which is which: what the related notes carry, what the
 * paper states, what a model read into the text. Nothing is ticked to begin
 * with and nothing is written until the button is pressed — a suggestion is a
 * question, and the frontmatter only ever holds an answer.
 *
 * The model is asked only from its own button. It is the one source that sends
 * the note away and costs money, so opening the dialog never does it.
 */
import { App, Modal, Notice, Setting, type ButtonComponent } from "obsidian";
import { t } from "../i18n";
import type { TagSuggestion } from "../services/tag-suggestions";

export interface TagSuggestHost {
  /** What the related notes and the note offer; the dialog opens before it arrives. */
  load: Promise<{ vault: readonly TagSuggestion[]; stated: readonly TagSuggestion[] }>;
  /** Ask the model; null when it could not be asked, which has been said. */
  askModel: () => Promise<TagSuggestion[] | null>;
  add: (tags: string[]) => void;
  closed: () => void;
}

export class TagSuggestModal extends Modal {
  private readonly chosen = new Set<string>();
  private submit: ButtonComponent | null = null;
  private isClosed = false;

  constructor(
    app: App,
    private readonly noteTitle: string,
    private readonly host: TagSuggestHost
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    const labels = t().tagSuggest;
    contentEl.empty();
    contentEl.addClass("schreibstube-tag-suggest");
    this.setTitle(labels.title(this.noteTitle));

    const vault = this.section(contentEl, labels.fromVault);
    const stated = this.section(contentEl, labels.fromNote);
    this.modelSection(contentEl);
    void this.host.load.then((found) => {
      // Closed while Recommended was still answering: nothing left to fill.
      if (this.isClosed) return;
      this.fill(vault, found.vault, labels.noneFromVault);
      this.fill(stated, found.stated, labels.noneFromNote);
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText(t().common.cancel).onClick(() => this.close()))
      .addButton((button) => {
        this.submit = button;
        button.setCta().onClick(() => {
          if (this.chosen.size === 0) return;
          const tags = [...this.chosen];
          this.close();
          this.host.add(tags);
        });
        this.updateSubmit();
      });
  }

  override onClose(): void {
    this.isClosed = true;
    this.contentEl.empty();
    this.host.closed();
  }

  /** A section with its heading, saying it is still being worked out. */
  private section(parent: HTMLElement, heading: string): HTMLElement {
    const section = parent.createDiv({ cls: "schreibstube-tag-suggest-section" });
    section.createDiv({ cls: "schreibstube-tag-suggest-heading", text: heading });
    const list = section.createDiv({ cls: "schreibstube-tag-suggest-list" });
    list.createDiv({ cls: "schreibstube-tag-suggest-empty", text: t().tagSuggest.loading });
    return list;
  }

  private fill(list: HTMLElement, suggestions: readonly TagSuggestion[], empty: string): void {
    list.empty();
    if (suggestions.length === 0) {
      list.createDiv({ cls: "schreibstube-tag-suggest-empty", text: empty });
    }
    for (const suggestion of suggestions) this.row(list, suggestion);
  }

  private modelSection(parent: HTMLElement): void {
    const labels = t().tagSuggest;
    const section = parent.createDiv({ cls: "schreibstube-tag-suggest-section" });
    section.createDiv({ cls: "schreibstube-tag-suggest-heading", text: labels.fromModel });
    const list = section.createDiv({ cls: "schreibstube-tag-suggest-list" });
    const ask = new Setting(list).setDesc(labels.modelDesc).addButton((button) =>
      button.setButtonText(labels.askModel).onClick(async () => {
        button.setDisabled(true).setButtonText(labels.asking);
        let suggestions: TagSuggestion[] | null = null;
        try {
          suggestions = await this.host.askModel();
        } catch (error) {
          // The host says what went wrong where it can; this is the rest.
          const detail = error instanceof Error ? error.message : String(error);
          new Notice(`${t().ai.failTags} — ${detail}`);
        }
        if (suggestions === null) {
          button.setDisabled(false).setButtonText(labels.askModel);
          return;
        }
        ask.settingEl.remove();
        if (suggestions.length === 0) {
          list.createDiv({ cls: "schreibstube-tag-suggest-empty", text: labels.noneFromModel });
        }
        for (const suggestion of suggestions) this.row(list, suggestion);
      })
    );
  }

  private row(list: HTMLElement, suggestion: TagSuggestion): void {
    const labels = t().tagSuggest;
    const row = list.createEl("label", { cls: "schreibstube-tag-suggest-row" });
    const box = row.createEl("input", { type: "checkbox" });
    box.addEventListener("change", () => {
      if (box.checked) this.chosen.add(suggestion.tag);
      else this.chosen.delete(suggestion.tag);
      this.updateSubmit();
    });
    row.createSpan({ cls: "schreibstube-tag-suggest-tag", text: `#${suggestion.tag}` });
    if (suggestion.isNew) {
      row.createSpan({ cls: "schreibstube-tag-suggest-new", text: labels.isNew });
    }
    if (suggestion.carriers !== undefined) {
      row.createSpan({
        cls: "schreibstube-tag-suggest-detail",
        text: labels.carriers(suggestion.carriers, suggestion.linked === true)
      });
    }
  }

  private updateSubmit(): void {
    this.submit
      ?.setButtonText(t().tagSuggest.add(this.chosen.size))
      .setDisabled(this.chosen.size === 0);
  }
}
