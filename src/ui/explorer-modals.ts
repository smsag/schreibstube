/**
 * The two dialogues the explorer needs beyond the icon picker: ask for a line
 * of text, and confirm something irreversible.
 *
 * Deliberately plain. Obsidian has no prompt of its own that a plugin may use,
 * and a bespoke one per action would be three near-identical modals.
 */
import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";

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

  onOpen(): void {
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

  onClose(): void {
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

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.options.title });
    contentEl.createEl("p", { text: this.options.message });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText(t().common.cancel).onClick(() => this.close()))
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

  onClose(): void {
    this.contentEl.empty();
  }
}
