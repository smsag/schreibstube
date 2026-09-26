/**
 * The dialogues the explorer needs beyond the icon picker: ask for a line of
 * text, confirm something irreversible, and pick a folder or a tag.
 *
 * Deliberately plain. Obsidian has no prompt of its own that a plugin may use,
 * and a bespoke one per action would be three near-identical modals.
 */
import { App, Modal, Setting, SuggestModal } from "obsidian";
import { t } from "../i18n";
import type { VaultTag } from "../services/tag-pins";
import { applyIcon, installIconFont } from "./icon-font";

export interface PromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  initial?: string;
  submitLabel: string;
  /** Return a message to keep the dialogue open and show why. */
  validate?: (value: string) => string | null;
}

export class PromptModal extends Modal {
  private value: string;

  constructor(
    app: App,
    private readonly options: PromptOptions,
    private readonly onSubmit: (value: string) => void
  ) {
    super(app);
    this.value = options.initial ?? "";
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.options.title });

    if (this.options.description) {
      contentEl.createEl("p", {
        text: this.options.description,
        cls: "schreibstube-prompt-desc"
      });
    }

    const error = contentEl.createEl("p", { cls: "schreibstube-prompt-error" });
    error.hide();

    const input = contentEl.createEl("input", {
      type: "text",
      cls: "schreibstube-prompt-input",
      attr: { placeholder: this.options.placeholder ?? "", "aria-label": this.options.title }
    });
    input.value = this.value;

    const submit = (): void => {
      const value = input.value.trim();
      const message = this.options.validate?.(value) ?? null;

      if (message !== null) {
        error.setText(message);
        error.show();
        return;
      }

      this.close();
      this.onSubmit(value);
    };

    input.addEventListener("input", () => error.hide());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText(t().common.cancel).onClick(() => this.close()))
      .addButton((button) =>
        button.setButtonText(this.options.submitLabel).setCta().onClick(submit)
      );

    window.setTimeout(() => {
      input.focus();
      // A rename starts with the name selected, so typing replaces it and
      // Enter alone keeps it.
      input.select();
    }, 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly options: { title: string; message: string; submitLabel: string },
    private readonly onConfirm: () => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.options.title });
    contentEl.createEl("p", { text: this.options.message });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(t().common.cancel).onClick(() => this.close());
        // Focus lands on the safe answer, so Enter from the keyboard that
        // opened the dialog declines rather than destroys. A keyboard user
        // who wants to confirm presses Tab once, which is one deliberate
        // step more than a mouse user's click — and the right amount.
        window.setTimeout(() => button.buttonEl.focus(), 0);
      })
      .addButton((button) =>
        button
          .setButtonText(this.options.submitLabel)
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Where to move a file or a folder: a list of the folders it may go into.
 *
 * The drag in the tree needs a mouse, and on a phone the long press belongs to
 * the context menu, so this list is the only way to move anything there. It
 * offers only destinations that would be accepted, the vault root first, so a
 * choice is never answered with a refusal.
 */
export class FolderPickerModal extends SuggestModal<string> {
  constructor(
    app: App,
    private readonly folders: readonly string[],
    placeholder: string,
    private readonly onChoose: (folder: string) => void
  ) {
    super(app);
    this.setPlaceholder(placeholder);
    installIconFont(this.containerEl.doc);
  }

  getSuggestions(query: string): string[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [...this.folders];

    return this.folders.filter((folder) => this.label(folder).toLowerCase().includes(needle));
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    el.addClass("schreibstube-folder-suggestion");
    applyIcon(
      el.createSpan({ cls: "schreibstube-explorer-glyph" }),
      folder.length === 0 ? "home" : "folder"
    );
    el.createSpan({ text: this.label(folder) });
  }

  onChooseSuggestion(folder: string): void {
    this.onChoose(folder);
  }

  /** The root has no path to show, so it is named instead. */
  private label(folder: string): string {
    return folder.length === 0 ? t().explorer.move.root : folder;
  }
}

/**
 * Which tag to pin: the vault's tags, most used first.
 *
 * Opened from the command palette on the whole vault, and from a note's menu on
 * that note's tags only — which is how a tag is reached on a phone, where the
 * palette is a detour and the long press on a row is right there.
 */
export class TagPickerModal extends SuggestModal<VaultTag> {
  constructor(
    app: App,
    private readonly tags: readonly VaultTag[],
    private readonly onChoose: (tag: string) => void
  ) {
    super(app);
    this.setPlaceholder(t().explorer.tags.pick);
    installIconFont(this.containerEl.doc);
  }

  getSuggestions(query: string): VaultTag[] {
    const needle = query.trim().replace(/^#/, "").toLowerCase();
    if (needle.length === 0) return [...this.tags];

    return this.tags.filter((entry) => entry.tag.toLowerCase().includes(needle));
  }

  renderSuggestion(entry: VaultTag, el: HTMLElement): void {
    el.addClass("schreibstube-folder-suggestion");
    applyIcon(el.createSpan({ cls: "schreibstube-explorer-glyph" }), "tag");
    el.createSpan({ text: `#${entry.tag}` });
    el.createSpan({
      cls: "schreibstube-tag-suggestion-count",
      text: t().explorer.tags.notes(entry.notes)
    });
  }

  onChooseSuggestion(entry: VaultTag): void {
    this.onChoose(entry.tag);
  }
}

/**
 * The description notes whose picture could not be found, to open one.
 *
 * The only place they are listed: an orphan is never removed, and a note the
 * person cannot find is as good as removed. Choosing one opens it, where the
 * embed shows what is missing and the link can be set by hand.
 */
export class OrphanListModal extends SuggestModal<string> {
  constructor(
    app: App,
    private readonly paths: readonly string[],
    private readonly onChoose: (path: string) => void
  ) {
    super(app);
    this.setPlaceholder(t().explorer.orphans.placeholder(paths.length));
  }

  getSuggestions(query: string): string[] {
    const needle = query.trim().toLowerCase();
    return this.paths.filter((path) => path.toLowerCase().includes(needle));
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.createSpan({ text: path });
  }

  onChooseSuggestion(path: string): void {
    this.onChoose(path);
  }
}
