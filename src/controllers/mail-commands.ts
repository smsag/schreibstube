import { MarkdownView, Notice, type App, type TFile } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { resolveApiKey } from "../services/secret";
import { searchMail, sendMail } from "../services/mail-client";
import {
  hasCriteria,
  normalizeBaseUrl,
  type MailBridgeConfig,
  type MailMessage,
  type SearchCriteria
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
      new Notice("Schreibstube: the note has no body to send.");
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
      const progress = new Notice("Schreibstube: sending…", 0);

      try {
        const result = await sendMail(bridge, {
          to: fields.to,
          cc: fields.cc,
          subject: fields.subject,
          text: body,
          from: settings.mailFrom || undefined
        });

        // The returned Message-ID is what later ties replies back to this note,
        // so it is persisted before anything else can go wrong.
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter[FM_MESSAGE_ID] = result.messageId;
          frontmatter[FM_SENT_AT] = result.sentAt;
        });

        this.logger.debug("Sent note as email:", result.messageId);
        new Notice(
          result.filedInSent
            ? "Schreibstube: email sent."
            : "Schreibstube: email sent (no copy filed in Sent)."
        );
      } catch (err) {
        this.fail("send", "Schreibstube: send failed", err);
      } finally {
        progress.hide();
      }
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

  private async performQuery(
    bridge: MailBridgeConfig,
    criteria: SearchCriteria
  ): Promise<void> {
    if (!hasCriteria(criteria)) {
      new Notice("Schreibstube: enter at least one search criterion.");
      return;
    }

    const messages = await this.runSearch(bridge, criteria);
    if (!messages) {
      return;
    }
    if (messages.length === 0) {
      new Notice("Schreibstube: no messages matched.");
      return;
    }

    new MailResultModal(this.app, messages, (message) => {
      this.insertMessage(message);
    }).open();
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
    if (!fields.messageId) {
      new Notice(
        `Schreibstube: this note has no ${FM_MESSAGE_ID} — send it as an email first.`
      );
      return;
    }

    const messages = await this.runSearch(bridge, { references: fields.messageId });
    if (!messages) {
      return;
    }

    const fresh = selectUnmerged(messages, fields.mergedIds);
    if (fresh.length === 0) {
      new Notice("Schreibstube: no new replies.");
      return;
    }

    const settings = this.getSettings();
    const content = await this.app.vault.read(file);
    const merged = appendToSection(content, settings.mailMergeHeading, formatMessages(fresh));
    await this.app.vault.modify(file, merged);

    // Recorded after the append so a failed write cannot mark messages as
    // merged when they never made it into the note.
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const existing = Array.isArray(frontmatter[FM_MERGED_IDS])
        ? (frontmatter[FM_MERGED_IDS] as unknown[]).map(String)
        : [];
      frontmatter[FM_MERGED_IDS] = [...existing, ...fresh.map(mergeKey)];
    });

    this.logger.debug(`Merged ${fresh.length} repl(y|ies) into`, file.path);
    new Notice(`Schreibstube: merged ${fresh.length} new message(s).`);
  }

  /** Run a search under the busy guard. Returns null when the search could not
   *  run at all; an empty array means "ran fine, matched nothing" — the callers
   *  word that differently, so it is deliberately not announced here. */
  private async runSearch(
    bridge: MailBridgeConfig,
    criteria: SearchCriteria
  ): Promise<MailMessage[] | null> {
    const settings = this.getSettings();
    let messages: MailMessage[] | null = null;

    await this.withBusy("search", async () => {
      const progress = new Notice("Schreibstube: searching mailbox…", 0);
      try {
        const result = await searchMail(bridge, {
          criteria,
          mailbox: settings.mailMailbox,
          limit: settings.mailMaxResults
        });

        if (result.truncated) {
          this.logger.info("Search hit the result limit; older matches were dropped.");
        }
        messages = result.messages;
      } catch (err) {
        this.fail("search", "Schreibstube: mailbox search failed", err);
      } finally {
        progress.hide();
      }
    });

    return messages;
  }

  private insertMessage(message: MailMessage): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Schreibstube: open a note in editing mode to insert the message.");
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

    const token = resolveApiKey(this.app.secretStorage, settings.mailTokenSecretName);
    if (!token.ok) {
      new Notice(token.message.replace("secret", "bridge token secret"));
      return null;
    }

    return { baseUrl: url.url, token: token.apiKey };
  }

  private async withBusy(label: string, work: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.logger.debug(`Ignoring ${label}: another mail command is already running.`);
      new Notice("Schreibstube: a mail command is already running — please wait.");
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
