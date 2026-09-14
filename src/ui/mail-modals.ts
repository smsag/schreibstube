import { t } from "../i18n";
import { App, Modal, Setting, SuggestModal } from "obsidian";
import { formatIsoMinutes } from "../utils/format-date";
import type { MailMessage, SearchCriteria } from "../services/mail-protocol";

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
    this.setPlaceholder("Filter results…");
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
    el.createEl("div", { text: message.subject || "(no subject)" });
    el.createEl("small", {
      text: [message.from, formatIsoMinutes(message.date)].filter(Boolean).join(" · "),
      cls: "schreibstube-mail-result-meta"
    });
  }

  onChooseSuggestion(message: MailMessage): void {
    this.onChoose(message);
  }
}

/**
 * Confirmation before a send.
 *
 * Sending is outward-facing and cannot be undone, and the command acts on
 * whichever note happens to be active — so the recipients and subject are shown
 * once before anything leaves the vault. A note that already carries a
 * `message_id` is flagged, since sending again produces a second mail rather
 * than updating the first.
 */
export class MailConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly details: {
      to: string[];
      cc: string[];
      subject: string;
      alreadySent: boolean;
    },
    private readonly onConfirm: () => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t().mail.confirmTitle });

    new Setting(contentEl).setName(t().mail.confirmTo).setDesc(this.details.to.join(", ") || "—");
    if (this.details.cc.length > 0) {
      new Setting(contentEl).setName(t().mail.confirmCc).setDesc(this.details.cc.join(", "));
    }
    new Setting(contentEl).setName(t().mail.confirmSubject).setDesc(this.details.subject);

    if (this.details.alreadySent) {
      contentEl.createEl("p", {
        text: t().mail.resendWarning,
        cls: "schreibstube-mail-warning"
      });
    }

    new Setting(contentEl)
      .addButton((button) => button.setButtonText(t().common.cancel).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(t().mail.send)
          .setCta()
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
