import { App, Modal, Setting, SuggestModal } from "obsidian";
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

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Search ${this.mailbox}` });

    this.addField(contentEl, "From", "sender@example.com", (value) => {
      this.criteria.from = value;
    });
    this.addField(contentEl, "Subject", "contains…", (value) => {
      this.criteria.subject = value;
    });
    this.addField(contentEl, "Text", "anywhere in the message", (value) => {
      this.criteria.text = value;
    });

    new Setting(contentEl).setName("Since").addText((text) => {
      text.inputEl.type = "date";
      text.onChange((value) => {
        this.criteria.since = value;
      });
    });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Search")
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

  onClose(): void {
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
      text: [message.from, formatDate(message.date)].filter(Boolean).join(" · "),
      cls: "schreibstube-mail-result-meta"
    });
  }

  onChooseSuggestion(message: MailMessage): void {
    this.onChoose(message);
  }
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace("T", " ").slice(0, 16);
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

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Send note as email" });

    new Setting(contentEl).setName("To").setDesc(this.details.to.join(", ") || "—");
    if (this.details.cc.length > 0) {
      new Setting(contentEl).setName("Cc").setDesc(this.details.cc.join(", "));
    }
    new Setting(contentEl).setName("Subject").setDesc(this.details.subject);

    if (this.details.alreadySent) {
      contentEl.createEl("p", {
        text:
          "This note already has a message_id — it was sent before. " +
          "Sending again delivers a second, separate email.",
        cls: "schreibstube-mail-warning"
      });
    }

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("Send")
          .setCta()
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
