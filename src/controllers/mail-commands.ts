import { MarkdownView, Notice, type App, type TFile } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { t } from "../i18n";
import { resolveApiKey } from "../services/secret";
import { searchMail, sendMail } from "../services/mail-client";
import { normalizeBaseUrl } from "../services/bridge-protocol";
import {
  hasCriteria,
  type MailBridgeConfig,
  type MailMessage,
  type SearchCriteria,
  type SendResult
} from "../services/mail-protocol";
import {
  FM_MERGED_IDS,
  FM_MESSAGE_ID,
  FM_SENT_AT,
  readMailFields,
  stripFrontmatter,
  validateSendable,
  type MailFields
} from "../services/mail-frontmatter";
import {
  appendToSection,
  formatMessage,
  formatMessages,
  mergeKey,
  selectUnmerged
} from "../services/mail-merge";
import { MailConfirmModal, MailResultModal, MailSearchModal } from "../ui/mail-modals";

/**
 * The three mail commands: send a note, query the mailbox, and merge replies
 * back into the note that started the thread.
 *
 * All traffic goes to the bridge over HTTPS (see `bridge/`), so these commands
 * work identically on desktop and mobile — the plugin never speaks IMAP or SMTP
 * itself. A single in-flight guard prevents overlapping requests, matching the
 * behaviour of the LLM commands.
 */
export class MailCommands {
  private busy = false;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger
  ) {}

  /** Send the active note. Addressing comes from frontmatter; the body is the
   *  note with its frontmatter stripped. */
  async sendNoteAsEmail(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return;
    }

    const bridge = this.requireBridge();
    if (!bridge) {
      return;
    }

    const fields = this.readFields(file);
    const sendable = validateSendable(fields);
    if (!sendable.ok) {
      new Notice(`Schreibstube: ${sendable.message}`);
      return;
    }

    const content = await this.app.vault.read(file);
    const body = stripFrontmatter(content).trim();
    if (!body) {
      new Notice(t().common.notice(t().mailNotices.noBody));
      return;
    }

    new MailConfirmModal(
      this.app,
      {
        to: fields.to,
        cc: fields.cc,
        subject: fields.subject,
        alreadySent: fields.messageId !== null
      },
      () => {
        void this.performSend(file, bridge, fields, body);
      }
    ).open();
  }

  private async performSend(
    file: TFile,
    bridge: MailBridgeConfig,
    fields: MailFields,
    body: string
  ): Promise<void> {
    await this.withBusy("send", async () => {
      const settings = this.getSettings();
      const progress = new Notice(t().common.notice(t().mailNotices.sending), 0);

      let result: SendResult;
      try {
        result = await sendMail(bridge, {
          to: fields.to,
          cc: fields.cc,
          subject: fields.subject,
          text: body,
          ...(settings.mailFrom ? { from: settings.mailFrom } : {})
        });
      } catch (err) {
        this.fail("send", t().mailNotices.failSend, err);
        return;
      } finally {
        progress.hide();
      }

      // The mail is delivered from here on. Anything that fails below must not
      // be reported as a failed send: the user would send again and deliver a
      // duplicate — and with message_id unwritten, the re-send warning would
      // not even fire.
      try {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter[FM_MESSAGE_ID] = result.messageId;
          frontmatter[FM_SENT_AT] = result.sentAt;
        });
      } catch (err) {
        this.logger.error("Email sent but the Message-ID could not be stored:", err);
        new Notice(
          `Schreibstube: email sent, but ${FM_MESSAGE_ID} could not be written to the note. ` +
            `Add it by hand to enable reply fetching: ${result.messageId}`,
          0
        );
        return;
      }

      this.logger.debug("Sent note as email:", result.messageId);
      new Notice(
        t().common.notice(result.filedInSent ? t().mailNotices.sent : t().mailNotices.sentNoCopy)
      );
    });
  }

  /** Search the mailbox and insert the chosen message into the active note. */
  async queryMailbox(): Promise<void> {
    const bridge = this.requireBridge();
    if (!bridge) {
      return;
    }

    const settings = this.getSettings();
    new MailSearchModal(this.app, settings.mailMailbox, (criteria) => {
      void this.performQuery(bridge, criteria);
    }).open();
  }

  private async performQuery(bridge: MailBridgeConfig, criteria: SearchCriteria): Promise<void> {
    if (!hasCriteria(criteria)) {
      new Notice(t().common.notice(t().mailNotices.noCriteria));
      return;
    }

    await this.withBusy("search", async () => {
      const progress = new Notice(t().common.notice(t().mailNotices.searching), 0);

      let messages: MailMessage[];
      try {
        messages = await this.runSearch(bridge, criteria);
      } catch (err) {
        this.fail("search", t().mailNotices.failSearch, err);
        return;
      } finally {
        progress.hide();
      }

      if (messages.length === 0) {
        new Notice(t().common.notice(t().mailNotices.noMessages));
        return;
      }

      new MailResultModal(this.app, messages, (message) => {
        this.insertMessage(message);
      }).open();
    });
  }

  /**
   * Find replies to the active note and append the new ones.
   *
   * Idempotent: messages already recorded in `merged_ids` are skipped, so the
   * command can be run as often as the user likes without duplicating content.
   */
  async fetchReplies(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return;
    }

    const bridge = this.requireBridge();
    if (!bridge) {
      return;
    }

    const fields = this.readFields(file);
    const messageId = fields.messageId;
    if (!messageId) {
      new Notice(t().common.notice(t().mailNotices.needsMessageId(FM_MESSAGE_ID)));
      return;
    }

    // The guard spans the whole flow, not just the network call: two
    // overlapping runs could otherwise both pass the merged_ids check and
    // append the same replies twice.
    await this.withBusy("fetch replies", async () => {
      const settings = this.getSettings();
      const progress = new Notice(t().common.notice(t().mailNotices.searching), 0);

      let messages: MailMessage[];
      try {
        messages = await this.runSearch(bridge, { references: messageId });
      } catch (err) {
        this.fail("fetch replies", t().mailNotices.failSearch, err);
        return;
      } finally {
        progress.hide();
      }

      const fresh = selectUnmerged(messages, fields.mergedIds);
      if (fresh.length === 0) {
        new Notice(t().common.notice(t().mailNotices.noReplies));
        return;
      }

      try {
        // Atomic read-modify-write. The note is usually open in an editor, and
        // a separate read + modify would race a pending editor flush — losing
        // either the user's unsaved typing or the merged replies.
        await this.app.vault.process(file, (data) =>
          appendToSection(data, settings.mailMergeHeading, formatMessages(fresh))
        );
      } catch (err) {
        this.fail("fetch replies", t().mailNotices.failMerge, err);
        return;
      }

      // Recorded only after the append succeeded, so a failed write can never
      // mark messages as merged when they never reached the note.
      try {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          const existing = Array.isArray(frontmatter[FM_MERGED_IDS])
            ? (frontmatter[FM_MERGED_IDS] as unknown[]).map(String)
            : [];
          frontmatter[FM_MERGED_IDS] = [...existing, ...fresh.map(mergeKey)];
        });
      } catch (err) {
        this.logger.error("Replies merged but merged_ids could not be updated:", err);
        new Notice(
          `Schreibstube: replies merged, but ${FM_MERGED_IDS} could not be updated — ` +
            "running the command again may duplicate them.",
          0
        );
        return;
      }

      this.logger.debug(`Merged ${fresh.length} new message(s) into`, file.path);
      new Notice(t().common.notice(t().mailNotices.merged(fresh.length)));
    });
  }

  /** Perform the search itself. Throws on failure and returns an empty array
   *  for "ran fine, matched nothing" — the callers hold the busy guard and
   *  word both outcomes differently. */
  private async runSearch(
    bridge: MailBridgeConfig,
    criteria: SearchCriteria
  ): Promise<MailMessage[]> {
    const settings = this.getSettings();
    const result = await searchMail(bridge, {
      criteria,
      mailbox: settings.mailMailbox,
      limit: settings.mailMaxResults
    });

    if (result.truncated) {
      this.logger.info("Search hit the result limit; older matches were dropped.");
    }

    return result.messages;
  }

  private insertMessage(message: MailMessage): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice(t().common.notice(t().mailNotices.needsEditor));
      return;
    }
    view.editor.replaceSelection(`${formatMessage(message)}\n`);
  }

  private readFields(file: TFile): MailFields {
    return readMailFields(this.app.metadataCache.getFileCache(file)?.frontmatter);
  }

  /** Resolve the bridge URL and token, reporting whichever is missing. */
  private requireBridge(): MailBridgeConfig | null {
    const settings = this.getSettings();

    const url = normalizeBaseUrl(settings.mailBridgeUrl);
    if (!url.ok) {
      new Notice(`Schreibstube: ${url.message}`);
      return null;
    }

    const token = resolveApiKey(
      this.app.secretStorage,
      settings.mailTokenSecretName,
      "bridge token"
    );
    if (!token.ok) {
      new Notice(token.message);
      return null;
    }

    return { baseUrl: url.url, token: token.apiKey };
  }

  private async withBusy(label: string, work: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.logger.debug(`Ignoring ${label}: another mail command is already running.`);
      new Notice(t().common.notice(t().mailNotices.busy));
      return;
    }
    this.busy = true;
    try {
      await work();
    } finally {
      this.busy = false;
    }
  }

  private fail(label: string, userMessage: string, err: unknown): void {
    this.logger.error(`${label} failed:`, err);
    const detail = err instanceof Error ? err.message : "unknown error";
    new Notice(`${userMessage} — ${detail}`);
  }
}
