import { t } from "../i18n";
import { App, Modal, Setting } from "obsidian";
import type { Logger } from "../services/logger";
import {
  checkSharePassword,
  DEFAULT_SHARE_EXPIRY,
  expiryForChoice,
  generateSharePassword,
  MAX_SHARE_PASSWORD_LENGTH,
  MIN_SHARE_PASSWORD_LENGTH,
  passwordForChoice,
  SHARE_EXPIRY_CHOICES,
  type ShareExpiry,
  type SharedLink
} from "../services/share-link";
import { copyText } from "./copy-text";

export interface ShareChoice {
  /** The link to rewrite, or none for a new one. */
  code?: string;
  password: string;
  /** When the link closes, null for never. */
  expiresAt: string | null;
}

/** What a link says about itself in a list: whether it asks for a password, and until when. */
export function linkSummary(link: SharedLink): string {
  const until = link.expiresAt
    ? t().share.until(new Date(link.expiresAt).toLocaleString())
    : t().share.untilRevoked;
  return `${link.protected ? t().share.withPassword : t().share.withoutPassword} · ${until}`;
}

/**
 * Share one note: the password, how long the link stays open, and the links
 * already made of it. A password is offered rather than required, so the
 * safe choice is the one already filled in.
 */
export class ShareModal extends Modal {
  private password = generateSharePassword();
  private expiry: ShareExpiry = DEFAULT_SHARE_EXPIRY;
  /** Whether the person chose the password, rather than taking the one drawn. */
  private passwordChosen = false;
  private expiryChosen = false;
  private warning: HTMLElement | null = null;
  private field: { setValue(value: string): unknown } | null = null;

  constructor(
    app: App,
    private readonly noteTitle: string,
    private readonly existing: readonly SharedLink[],
    private readonly onSubmit: (choice: ShareChoice) => void,
    private readonly onRevoke: (link: SharedLink) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t().share.title(this.noteTitle) });
    contentEl.createEl("p", { text: t().share.intro });

    new Setting(contentEl)
      .setName(t().share.password)
      .setDesc(t().share.passwordDesc)
      .addText((text) => {
        this.field = text;
        text.setValue(this.password).onChange((value) => {
          this.password = value;
          this.passwordChosen = true;
          this.validate();
        });
      })
      .addButton((button) =>
        button.setButtonText(t().share.passwordGenerate).onClick(() => {
          this.password = generateSharePassword();
          this.passwordChosen = true;
          this.field?.setValue(this.password);
          this.validate();
        })
      );

    new Setting(contentEl)
      .setName(t().share.expiry)
      .setDesc(t().share.expiryDesc)
      .addDropdown((dropdown) => {
        for (const choice of SHARE_EXPIRY_CHOICES) {
          dropdown.addOption(choice, t().share.expiryChoices[choice]);
        }
        dropdown.setValue(this.expiry).onChange((value) => {
          this.expiry = value as ShareExpiry;
          this.expiryChosen = true;
        });
      });

    this.warning = contentEl.createEl("p", { cls: "schreibstube-share-warning" });

    if (this.existing.length > 0) {
      new Setting(contentEl)
        .setName(t().share.existing)
        .setDesc(t().share.existingDesc)
        .setHeading();
      for (const link of this.existing) {
        new Setting(contentEl)
          .setName(link.url)
          .setDesc(linkSummary(link))
          .addButton((button) =>
            button.setButtonText(t().share.update).onClick(() => this.submit(link))
          )
          .addButton((button) =>
            button
              .setButtonText(t().share.revoke)
              .setWarning()
              .onClick(() => {
                this.close();
                this.onRevoke(link);
              })
          );
      }
    }

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText(t().share.create)
        .setCta()
        .onClick(() => this.submit())
    );
  }

  /** The password as the bridge would take it, said beside the field when it would not. */
  private validate(): boolean {
    const check = checkSharePassword(this.password);
    const message =
      check === "short"
        ? t().share.passwordShort(MIN_SHARE_PASSWORD_LENGTH)
        : check === "long"
          ? t().share.passwordLong(MAX_SHARE_PASSWORD_LENGTH)
          : "";
    this.warning?.setText(message);
    return message === "";
  }

  /** Write the link, once the password is one to write it with (`passwordForChoice`). */
  private submit(link?: SharedLink): void {
    if (!this.validate()) return;
    const password = passwordForChoice({
      password: this.password,
      chosen: this.passwordChosen,
      ...(link ? { link } : {})
    });
    if (password === null) {
      this.password = "";
      this.field?.setValue("");
      this.warning?.setText(t().share.updatePassword);
      return;
    }
    this.close();
    this.onSubmit({
      ...(link ? { code: link.code } : {}),
      password,
      expiresAt: expiryForChoice({
        expiry: this.expiry,
        edited: this.expiryChosen,
        ...(link ? { link } : {}),
        now: Date.now()
      })
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** The link once it is up, and the password once more, each to copy on its own. */
export class ShareResultModal extends Modal {
  constructor(
    app: App,
    private readonly link: SharedLink,
    private readonly password: string,
    private readonly logger: Logger
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t().share.resultTitle });

    new Setting(contentEl)
      .setName(t().share.resultLink)
      .setDesc(this.link.url)
      .addButton((button) =>
        button
          .setButtonText(t().share.copyLink)
          .setCta()
          .onClick(() => void this.copy(this.link.url, t().share.linkCopied, "the share link"))
      );
    if (this.password) {
      new Setting(contentEl)
        .setName(t().share.resultPassword)
        .setDesc(this.password)
        .addButton((button) =>
          button
            .setButtonText(t().share.copyPassword)
            .onClick(() => void this.copy(this.password, t().share.passwordCopied, "the password"))
        );
      contentEl.createEl("p", { text: t().share.resultHint });
    }
    contentEl.createEl("p", { text: linkSummary(this.link), cls: "schreibstube-publish-target" });

    new Setting(contentEl).addButton((button) =>
      button.setButtonText(t().common.close).onClick(() => this.close())
    );
  }

  private copy(text: string, copied: string, logAs: string): Promise<void> {
    return copyText(text, { copied, failed: t().share.copyFailed }, this.logger, logAs);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Every open link of one site, to copy or take down. */
export class ShareListModal extends Modal {
  constructor(
    app: App,
    private readonly accountName: string,
    private readonly links: SharedLink[],
    private readonly onRevoke: (link: SharedLink) => Promise<boolean>,
    private readonly logger: Logger
  ) {
    super(app);
  }

  override onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t().share.listTitle(this.accountName) });
    if (this.links.length === 0) {
      contentEl.createEl("p", { text: t().share.listEmpty });
    }
    for (const link of this.links) {
      new Setting(contentEl)
        .setName(link.title || link.sourcePath)
        .setDesc(`${link.url} · ${linkSummary(link)}`)
        .addButton((button) =>
          button
            .setButtonText(t().share.copyLink)
            .onClick(
              () =>
                void copyText(
                  link.url,
                  { copied: t().share.linkCopied, failed: t().share.copyFailed },
                  this.logger,
                  "the share link"
                )
            )
        )
        .addButton((button) =>
          button
            .setButtonText(t().share.revoke)
            .setWarning()
            .onClick(async () => {
              button.setDisabled(true);
              if (await this.onRevoke(link)) {
                this.links.splice(this.links.indexOf(link), 1);
                this.render();
              } else {
                button.setDisabled(false);
              }
            })
        );
    }
    new Setting(contentEl).addButton((button) =>
      button.setButtonText(t().common.close).onClick(() => this.close())
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
