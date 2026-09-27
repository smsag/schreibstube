import { t } from "../i18n";
import { App, Modal, Setting, SuggestModal } from "obsidian";
import { formatIsoMinutes } from "../utils/format-date";
import type { MailMessage, SearchCriteria } from "../services/mail-protocol";
import type { SendWarning } from "../services/mail-draft";

/**
 * Criteria form for "Query mailbox". Every field is optional on its own, but
 * the caller rejects a completely empty search — an unfiltered IMAP query would
 * return the whole mailbox.
 */
export class MailSearchModal extends Modal {
  private criteria: SearchCriteria = {};

  constructor(
    app: App,
    private readonly mailbox: string,
    private readonly onSubmit: (criteria: SearchCriteria) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t().mail.searchTitle(this.mailbox) });

    this.addField(contentEl, t().mail.searchFrom, t().mail.searchPlaceholderFrom, (value) => {
      this.criteria.from = value;
    });
    this.addField(contentEl, t().mail.searchSubject, t().mail.searchPlaceholderSubject, (value) => {
      this.criteria.subject = value;
    });
    this.addField(contentEl, t().mail.searchText, t().mail.searchPlaceholderText, (value) => {
      this.criteria.text = value;
    });

    new Setting(contentEl).setName(t().mail.searchSince).addText((text) => {
      text.inputEl.type = "date";
      text.onChange((value) => {
        this.criteria.since = value;
      });
    });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText(t().mail.search)
        .setCta()
        .onClick(() => this.submit())
    );

    // Enter submits from any field, which is what a search form should do.
    contentEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });

    contentEl.querySelector("input")?.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private addField(
    parent: HTMLElement,
    name: string,
    placeholder: string,
    onChange: (value: string) => void
  ): void {
    new Setting(parent).setName(name).addText((text) => {
      text.setPlaceholder(placeholder).onChange(onChange);
    });
  }

  private submit(): void {
    this.close();
    this.onSubmit(this.criteria);
  }
}

/** Result picker. Suggestions are already fetched, so the query box just
 *  narrows the list locally rather than hitting the bridge again. */
export class MailResultModal extends SuggestModal<MailMessage> {
  constructor(
    app: App,
    private readonly messages: MailMessage[],
    private readonly onChoose: (message: MailMessage) => void
  ) {
    super(app);
    this.setPlaceholder(t().mail.filterResults);
  }

  getSuggestions(query: string): MailMessage[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return this.messages;
    }
    return this.messages.filter((message) =>
      `${message.subject} ${message.from}`.toLowerCase().includes(needle)
    );
  }

  renderSuggestion(message: MailMessage, el: HTMLElement): void {
    el.createEl("div", { text: message.subject || t().mail.noSubject });
    el.createEl("small", {
      text: [message.from, formatIsoMinutes(message.date)].filter(Boolean).join(" · "),
      cls: "schreibstube-mail-result-meta"
    });
  }

  onChooseSuggestion(message: MailMessage): void {
    this.onChoose(message);
  }
}

/** What the confirmation shows: exactly what Send will send. */
export interface MailConfirmDetails {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  warnings: SendWarning[];
}

/**
 * The last look before a mail leaves.
 *
 * Send does not close the dialogue by itself: the caller reads the note again
 * and answers whether it still says what is shown. If it does not, the
 * dialogue is drawn again from the note as it is now, and a second press sends
 * that — never a version nobody saw.
 */
export class MailConfirmModal extends Modal {
  private changed = false;

  constructor(
    app: App,
    private details: MailConfirmDetails,
    /** Resolves true when the mail was handed on and the dialogue may close. */
    private readonly onConfirm: () => Promise<boolean>
  ) {
    super(app);
  }

  /** Redraw from the note as it is now, saying that it changed. */
  update(details: MailConfirmDetails): void {
    this.details = details;
    this.changed = true;
    this.render();
  }

  override onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t().mail.confirmTitle });

    if (this.changed) {
      contentEl.createEl("p", {
        text: t().mail.changedSinceShown,
        cls: "schreibstube-mail-warning"
      });
    }

    const { details } = this;
    new Setting(contentEl)
      .setName(t().mail.confirmFrom)
      .setDesc(details.from || t().mail.confirmFromDefault);
    new Setting(contentEl).setName(t().mail.confirmTo).setDesc(details.to.join(", ") || "—");
    if (details.cc.length > 0) {
      new Setting(contentEl).setName(t().mail.confirmCc).setDesc(details.cc.join(", "));
    }
    new Setting(contentEl).setName(t().mail.confirmSubject).setDesc(details.subject);

    for (const warning of details.warnings) {
      contentEl.createEl("p", { text: warningText(warning), cls: "schreibstube-mail-warning" });
    }

    contentEl.createEl("pre", { text: details.body, cls: "schreibstube-mail-preview" });

    let sending = false;
    new Setting(contentEl)
      .addButton((button) => button.setButtonText(t().common.cancel).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(t().mail.send)
          .setCta()
          .onClick(async () => {
            // A second press while the note is read again would send twice.
            if (sending) return;
            sending = true;
            button.setDisabled(true);
            try {
              if (await this.onConfirm()) this.close();
            } finally {
              sending = false;
              button.setDisabled(false);
            }
          })
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

function warningText(warning: SendWarning): string {
  switch (warning) {
    case "unconfirmed":
      return t().mail.unconfirmedWarning;
    case "alreadySent":
      return t().mail.resendWarning;
    case "noTo":
      return t().mail.noToWarning;
  }
}
