import { Modal, Setting, type App } from "obsidian";
import { t } from "../i18n";
import { modalAnswer, type ModalAnswer } from "../services/modal-answer";

/**
 * Ask whether a bridge token may go to an origin this device has not sent it
 * to. Closing the dialogue is a no; the safe answer has the focus.
 */
export function askToSendToken(
  app: App,
  text: { title: string; message: string }
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    new BridgeOriginModal(app, text, modalAnswer(resolve)).open();
  });
}

class BridgeOriginModal extends Modal {
  constructor(
    app: App,
    private readonly text: { title: string; message: string },
    private readonly answer: ModalAnswer<boolean>
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.text.title });
    contentEl.createEl("p", { text: this.text.message });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(t().common.cancel).onClick(() => this.close());
        window.setTimeout(() => button.buttonEl.focus(), 0);
      })
      .addButton((button) =>
        button
          .setButtonText(t().bridgeTrust.confirm)
          .setWarning()
          .onClick(() => {
            this.answer.choose(true);
            this.close();
          })
      );
  }

  override onClose(): void {
    this.contentEl.empty();
    this.answer.closed(false);
  }
}
