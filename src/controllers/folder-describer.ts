/**
 * "Describe pictures" on a folder: every picture under it that has no
 * description gets one.
 *
 * The order is the point. Orphaned notes are re-linked by content first,
 * because a picture renamed outside Obsidian already has its description and
 * matching it costs a hash, where describing it again costs a request. What
 * is still undescribed is planned in `services/folder-descriptions`, shown to
 * the person with its count and where it goes, and sent only when they say so.
 * The run can be stopped between two pictures; what was written stays.
 */
import { Notice, TFile, type App, type TFolder } from "obsidian";
import { t } from "../i18n";
import { MAX_FOLDER_DESCRIPTIONS, planFolderDescriptions } from "../services/folder-descriptions";
import { getImageMimeType, MAX_IMAGE_BYTES } from "../services/image-resize";
import { providerLabel } from "../services/llm-providers";
import { modalAnswer } from "../services/modal-answer";

import type { Logger } from "../services/logger";
import type { SchreibstubeSettings } from "../types";
import { ConfirmModal } from "../ui/explorer-modals";
import type { ExplorerController } from "./explorer-controller";
import type { LlmCommands } from "./llm-commands";

export class FolderDescriber {
  private stopRequested = false;
  private running = false;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly llm: () => LlmCommands,
    private readonly explorer: () => ExplorerController | null,
    private readonly logger: Logger
  ) {}

  async describe(folder: TFolder): Promise<void> {
    const messages = t().ai.folder;
    if (!this.getSettings().imageDescriptionsEnabled) {
      new Notice(t().common.notice(messages.off));
      return;
    }
    if (this.running) {
      new Notice(t().common.notice(t().ai.busy));
      return;
    }
    // Taken here, before the plan and the question, not when the run starts:
    // two menus pressed in turn used to open two dialogs, and both runs went.
    this.running = true;
    let handedOn = false;
    try {
      handedOn = await this.plan(folder);
    } finally {
      if (!handedOn) this.running = false;
    }
  }

  /**
   * Plan what to describe and ask. Answers whether the run has been handed
   * the guard: true once the dialog owns it, false when nothing more follows.
   */
  private async plan(folder: TFolder): Promise<boolean> {
    const messages = t().ai.folder;
    // The pairing of pictures and notes lives with the pane, which builds it
    // at load whether or not the pane is open.
    const explorer = this.explorer();
    if (!explorer) return false;

    let relinked = 0;
    try {
      relinked = (await explorer.repairOrphans()).repaired;
    } catch (error) {
      this.logger.warn("Could not match orphaned picture descriptions:", error);
    }

    const pictures = this.app.vault
      .getFiles()
      .filter((file) => getImageMimeType(file.extension) !== null && !explorer.isTrashed(file.path))
      .map((file) => ({ path: file.path, size: file.stat.size }));
    const plan = planFolderDescriptions(
      folder.path,
      pictures,
      (path) => explorer.descriptionNoteOf(path) !== null,
      MAX_IMAGE_BYTES
    );
    const name = folder.isRoot() ? this.app.vault.getName() : folder.name;
    const notes = [
      ...(relinked > 0 ? [messages.relinked(relinked)] : []),
      ...(plan.tooLarge.length > 0
        ? [messages.tooLarge(plan.tooLarge.length, MAX_IMAGE_BYTES / (1024 * 1024))]
        : []),
      ...(plan.deferred > 0 ? [messages.deferred(plan.deferred, MAX_FOLDER_DESCRIPTIONS)] : [])
    ];

    if (plan.describe.length === 0) {
      new Notice(t().common.notice([messages.nothing(name, plan.described), ...notes].join(" ")));
      return false;
    }

    // Dismissed is an answer too: the guard goes back with it, or the next
    // "Describe pictures" would be refused for the rest of the session.
    const confirmed = await new Promise<boolean>((resolve) => {
      const answer = modalAnswer<boolean>(resolve);
      const modal = new ConfirmModal(
        this.app,
        {
          title: messages.confirmTitle(plan.describe.length, name),
          message: [
            messages.confirmBody(
              plan.describe.length,
              providerLabel(this.getSettings().llmProvider)
            ),
            ...notes
          ].join(" "),
          submitLabel: messages.confirmAction
        },
        () => answer.choose(true)
      );
      const close = modal.onClose.bind(modal);
      modal.onClose = () => {
        close();
        answer.closed(false);
      };
      modal.open();
    });
    if (!confirmed) return false;
    void this.run(plan.describe, name);
    return true;
  }

  private async run(paths: readonly string[], name: string): Promise<void> {
    const messages = t().ai.folder;
    const files = paths
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile);

    // One notice for the whole run, rewritten as it goes, with the stop in it.
    const fragment = document.createDocumentFragment();
    const status = fragment.appendChild(document.createElement("span"));
    const stop = fragment.appendChild(document.createElement("span"));
    stop.className = "schreibstube-notice-action";
    stop.setAttribute("role", "button");
    stop.setAttribute("tabindex", "0");
    stop.textContent = messages.stop;
    const requestStop = (): void => {
      this.stopRequested = true;
      stop.remove();
      status.textContent = messages.stopping;
    };
    stop.addEventListener("click", requestStop);
    stop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        requestStop();
      }
    });
    status.textContent = messages.progress(0, files.length, name);
    const notice = new Notice(fragment, 0);

    this.stopRequested = false;
    try {
      const result = await this.llm().describeImages(
        files,
        (done, total) => {
          if (!this.stopRequested) status.textContent = messages.progress(done, total, name);
        },
        () => this.stopRequested
      );
      if (!result) return;

      const summary = [
        messages.done(result.described, name),
        ...(result.unusable > 0 ? [messages.unusable(result.unusable)] : []),
        ...(result.failed > 0 ? [messages.failed(result.failed)] : []),
        ...(result.stopped ? [messages.stopped] : [])
      ];
      new Notice(t().common.notice(summary.join(" ")), 10_000);
    } finally {
      notice.hide();
      this.running = false;
    }
  }
}
