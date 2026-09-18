import { t } from "../i18n";
import { App, Modal, Setting, SuggestModal } from "obsidian";
import type { PublishAccount } from "../types";
import type { PublishPlan } from "../services/publish-protocol";

/**
 * What will happen, before it happens.
 *
 * Publishing writes to a public site and deletes files there, so the plan is
 * shown in full rather than summarised: the deletions especially, because that
 * is the part a mistaken folder or slug shows up in.
 */
export class PublishPlanModal extends Modal {
  constructor(
    app: App,
    private readonly account: PublishAccount,
    private readonly plan: PublishPlan,
    private readonly onConfirm: (() => void) | null
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t().publish.planTitle(this.account.name) });

    const summary = contentEl.createEl("ul", { cls: "schreibstube-publish-summary" });
    this.line(summary, t().publish.planNotes(this.plan.notes, this.account.folder));
    this.line(summary, t().publish.planUploadNotes(this.plan.uploadSources.length));
    this.line(summary, t().publish.planUploadAssets(this.plan.uploadAssets.length));
    this.line(summary, t().publish.planUnchanged(this.plan.unchangedSources));
    this.line(summary, t().publish.planDelete(this.plan.willDelete.length));

    if (this.plan.willDelete.length > 0) {
      contentEl.createEl("p", {
        text: t().publish.planDeleteHeading,
        cls: "schreibstube-publish-heading"
      });
      const list = contentEl.createEl("ul", { cls: "schreibstube-publish-list" });
      for (const path of this.plan.willDelete.slice(0, 20)) {
        list.createEl("li", { text: path });
      }
      if (this.plan.willDelete.length > 20) {
        list.createEl("li", { text: t().publish.planMore(this.plan.willDelete.length - 20) });
      }
    }

    contentEl.createEl("p", {
      text: this.plan.baseUrl,
      cls: "schreibstube-publish-target"
    });

    new Setting(contentEl).addButton((button) => {
      if (!this.onConfirm) {
        return button.setButtonText(t().common.close).onClick(() => this.close());
      }
      return button
        .setButtonText(t().publish.planConfirm)
        .setCta()
        .onClick(() => {
          this.close();
          this.onConfirm?.();
        });
    });
  }

  private line(list: HTMLElement, text: string): void {
    list.createEl("li", { text });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Which account, when more than one is configured. */
export class PublishAccountModal extends SuggestModal<PublishAccount> {
  constructor(
    app: App,
    private readonly accounts: PublishAccount[],
    private readonly onChoose: (account: PublishAccount) => void
  ) {
    super(app);
    this.setPlaceholder(t().publish.chooseAccount);
  }

  getSuggestions(query: string): PublishAccount[] {
    const needle = query.toLowerCase();
    return this.accounts.filter(
      (account) =>
        account.name.toLowerCase().includes(needle) || account.folder.toLowerCase().includes(needle)
    );
  }

  renderSuggestion(account: PublishAccount, el: HTMLElement): void {
    el.createEl("div", { text: account.name });
    el.createEl("small", { text: `${account.folder} → ${account.target}` });
  }

  onChooseSuggestion(account: PublishAccount): void {
    this.onChoose(account);
  }
}
