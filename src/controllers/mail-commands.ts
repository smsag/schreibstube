import { getFrontMatterInfo, MarkdownView, Notice, parseYaml, TFile, type App } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { t } from "../i18n";
import { resolveApiKey } from "../services/secret";
import { fetchAttachments, searchMail, sendMail } from "../platform/mail-client";
import { bridgeHealth } from "../platform/publish-client";
import { normalizeBaseUrl } from "../services/bridge-protocol";
import {
  excludeFromMerged,
  hasCriteria,
  MAIL_ATTACHMENTS_PROTOCOL,
  MAIL_EXCLUDE_PROTOCOL,
  MAIL_IMPORT_PROTOCOL,
  MAX_MAIL_ATTACHMENT_BYTES,
  toBase64,
  type AttachmentsResult,
  type ImportedAttachment,
  type MailBridgeConfig,
  type MailMessage,
  type SearchCriteria,
  type SendResult
} from "../services/mail-protocol";
import { MAIL_DIAGRAM_LANGUAGES, mailFigures, type DrawnFigure } from "../services/mail-figures";
import {
  diagramKeyInput,
  DrawnDiagrams,
  findDiagramFences,
  type DiagramFence
} from "../services/publish-diagrams";
import { sha256 } from "../utils/sha256";
import { confirmBridge } from "./bridge-trust";
import { DiagramCapture } from "./diagram-capture";
import { NO_FORMULAS, type NoteFormulas } from "./sums-controller";
import type { FreezeEntry } from "../services/table-formulas";
import {
  FM_MERGED_IDS,
  FM_MESSAGE_ID,
  FM_SEND_UNCONFIRMED,
  FM_SENT_AT,
  mergedIdsAfter,
  readMailFields,
  validateSendable,
  type MailFields
} from "../services/mail-frontmatter";
import {
  buildMailDraft,
  isUnconfirmedSend,
  sameDraft,
  sendWarnings,
  type MailDraft
} from "../services/mail-draft";
import {
  appendToSection,
  formatMessage,
  formatMessages,
  mergeKey,
  selectUnmerged
} from "../services/mail-merge";
import { attachmentQuoteLines, isImageAttachment } from "../services/mail-import";
import {
  MailConfirmModal,
  MailResultModal,
  MailSearchModal,
  type MailConfirmDetails,
  type SearchOptions
} from "../ui/mail-modals";

/**
 * The three mail commands: send a note, query the mailbox, and merge replies
 * back into the note that started the thread. All traffic goes to the bridge
 * over HTTPS, so the commands work identically on desktop and mobile.
 */
export class MailCommands {
  private busy = false;
  private readonly diagrams: DiagramCapture;
  /**
   * Diagrams drawn for this session's mails, by content: the dialogue reads the
   * note again when Send is pressed, and must not draw everything twice.
   */
  private readonly drawn = new DrawnDiagrams<KeptFigure>();
  /**
   * Each bridge's protocol, by its URL, asked once per session when a note has
   * a diagram. By URL, because the settings can point at another bridge
   * mid-session and the answer of the old one said nothing about the new.
   */
  private readonly bridgeProtocols = new Map<string, number>();
  private formulas: NoteFormulas = NO_FORMULAS;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger,
    /** Offer the Mail property set when a note lacks the keys to send. */
    private readonly offerFields: ((file: TFile, message: string) => void) | null = null
  ) {
    this.diagrams = new DiagramCapture(app, logger, "mail", MAX_MAIL_ATTACHMENT_BYTES);
  }

  /** A note's formulas: resolved in the body, and `(fixed)` ones frozen once delivered. */
  useFormulas(formulas: NoteFormulas): void {
    this.formulas = formulas;
  }

  /** Send the active note. Addressing comes from frontmatter; the body is the
   *  rest of the note, as plain text. */
  async sendNoteAsEmail(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return;
    }

    const bridge = await this.requireBridge();
    if (!bridge) {
      return;
    }

    const read = await this.readDraft(file, bridge);
    if (!read || !this.checkDraft(file, read.draft)) {
      return;
    }

    let shown = read.draft;
    const modal = new MailConfirmModal(this.app, confirmDetails(read.draft), async () => {
      // Read the note again at the press: a property typed just before the
      // command reaches the file only after the dialogue opened, and the send
      // must carry what the note says now, which must be what was shown.
      const now = await this.readDraft(file, bridge);
      if (!now || !this.checkDraft(file, now.draft)) {
        return true;
      }
      if (!sameDraft(shown, now.draft)) {
        shown = now.draft;
        modal.update(confirmDetails(now.draft));
        return false;
      }
      void this.performSend(file, bridge, now);
      return true;
    });
    modal.open();
  }

  /**
   * The note as one send: recipients, subject and body from one reading of
   * the file. The metadata cache is not asked — it trails the file, and a send
   * built from both mixed an old frontmatter with a new body.
   */
  private async readDraft(file: TFile, bridge: MailBridgeConfig): Promise<ReadDraft | null> {
    const content = await this.app.vault.read(file);
    const info = getFrontMatterInfo(content);

    let frontmatter: unknown = {};
    if (info.exists) {
      try {
        frontmatter = parseYaml(info.frontmatter) as unknown;
      } catch (err) {
        this.logger.error("The note's frontmatter could not be parsed:", err);
        new Notice(t().common.notice(t().mailNotices.frontmatterUnreadable));
        return null;
      }
    }

    const exported = await this.formulas.forExport(content.slice(info.contentStart));
    const { freezes } = exported;
    const body = exported.text;
    const from = this.getSettings().mailFrom;
    const fences = findDiagramFences(body, MAIL_DIAGRAM_LANGUAGES);
    if (fences.length === 0) return { draft: buildMailDraft(frontmatter, body, from), freezes };

    // Asked before anything is drawn: a bridge that cannot carry the pictures
    // would deliver the mail without them while its text points at them.
    const takesPictures = await this.bridgeTakesPictures(bridge);
    if (takesPictures === "unknown") {
      new Notice(t().common.notice(t().mailNotices.bridgeUnreachable));
    }
    const drawn = takesPictures === "yes" ? await this.drawFigures(fences, file.path) : new Map();
    const figures = mailFigures(body, fences, drawn, {
      figure: t().mail.figure,
      attached: t().mail.figureAttached
    });
    const draft = buildMailDraft(frontmatter, figures.markdown, from, {
      attachments: figures.attachments,
      undrawn: figures.undrawn,
      bridgeTooOld: takesPictures === "no"
    });
    return { draft, freezes };
  }

  /**
   * Whether the bridge takes pictures on a send.
   *
   * A bridge that cannot be asked is not thereby an old one: the diagrams go
   * as their source either way, but "unknown" is said as a failed question,
   * where "no" told people to redeploy a bridge that was only unreachable.
   * Only an answer is kept; a failed question is asked again.
   */
  private async bridgeTakesPictures(bridge: MailBridgeConfig): Promise<"yes" | "no" | "unknown"> {
    return this.bridgeSpeaks(bridge, MAIL_ATTACHMENTS_PROTOCOL);
  }

  /** Whether the bridge speaks `protocol` or later; see `bridgeTakesPictures`. */
  private async bridgeSpeaks(
    bridge: MailBridgeConfig,
    protocol: number
  ): Promise<"yes" | "no" | "unknown"> {
    let spoken = this.bridgeProtocols.get(bridge.baseUrl);
    if (spoken === undefined) {
      try {
        spoken = (await bridgeHealth(bridge)).protocol;
      } catch (err) {
        this.logger.warn("Mail bridge health check failed:", err);
        return "unknown";
      }
      this.bridgeProtocols.set(bridge.baseUrl, spoken);
    }
    return spoken >= protocol ? "yes" : "no";
  }

  /** Every diagram's pictures, drawn now or kept from the last reading. */
  private async drawFigures(
    fences: readonly DiagramFence[],
    sourcePath: string
  ): Promise<Map<number, DrawnFigure>> {
    const figures = new Map<number, DrawnFigure>();
    let progress: Notice | null = null;
    try {
      for (const fence of fences) {
        const key = await sha256(new TextEncoder().encode(diagramKeyInput(fence)));
        let kept = this.drawn.get(key);
        if (!kept) {
          const message = t().common.notice(
            t().mailNotices.drawing(fence.index + 1, fences.length)
          );
          if (progress) progress.setMessage(message);
          else progress = new Notice(message, 0);

          const capture = await this.diagrams.capture(fence, sourcePath);
          // Whole or not at all: a carousel short of a panel is not attached.
          if (capture.pictures.length === 0 || capture.pictures.length < capture.expected) continue;
          kept = { pictures: capture.pictures.map((bytes) => ({ bytes })), title: capture.title };
          this.drawn.set(key, kept);
        }
        figures.set(fence.index, {
          pictures: kept.pictures.map((picture) => picture.bytes),
          title: kept.title
        });
      }
    } finally {
      progress?.hide();
    }
    return figures;
  }

  /** Whether the draft can be sent at all, saying why not where it cannot. */
  private checkDraft(file: TFile, draft: MailDraft): boolean {
    const sendable = validateSendable(draft.fields);
    if (!sendable.ok) {
      if (sendable.missing && this.offerFields) this.offerFields(file, sendable.message);
      else new Notice(t().common.notice(sendable.message));

      return false;
    }
    if (!draft.body) {
      new Notice(t().common.notice(t().mailNotices.noBody));
      return false;
    }
    return true;
  }

  private async performSend(
    file: TFile,
    bridge: MailBridgeConfig,
    { draft, freezes }: ReadDraft
  ): Promise<void> {
    await this.withBusy("send", async () => {
      const progress = new Notice(t().common.notice(t().mailNotices.sending), 0);
      const { fields } = draft;

      let result: SendResult;
      try {
        result = await sendMail(bridge, {
          to: fields.to,
          cc: fields.cc,
          subject: fields.subject,
          text: draft.body,
          ...(draft.from ? { from: draft.from } : {}),
          // Left out when there are none, so a mail without diagrams is the
          // same request any bridge has always taken.
          ...(draft.attachments.length > 0
            ? {
                attachments: draft.attachments.map((attachment) => ({
                  filename: attachment.filename,
                  contentType: "image/png" as const,
                  content: toBase64(attachment.bytes)
                }))
              }
            : {})
        });
      } catch (err) {
        if (isUnconfirmedSend(err)) {
          await this.markUnconfirmed(file, err);
        } else {
          this.fail("send", t().mailNotices.failSend, err);
        }
        return;
      } finally {
        progress.hide();
      }

      // The mail is delivered from here on. Anything that fails below must not
      // be reported as a failed send: the user would send again and deliver a
      // duplicate — and with message_id unwritten, the re-send warning would
      // not even fire.
      await this.freezeSent(file, freezes);
      try {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter[FM_MESSAGE_ID] = result.messageId;
          frontmatter[FM_SENT_AT] = result.sentAt;
          delete frontmatter[FM_SEND_UNCONFIRMED];
        });
      } catch (err) {
        this.logger.error("Email sent but the Message-ID could not be stored:", err);
        new Notice(
          t().common.notice(t().mailNotices.sentButIdUnwritten(FM_MESSAGE_ID, result.messageId)),
          0
        );
        return;
      }

      this.logger.debug("Sent note as email:", result.messageId);
      if (result.rejected.length > 0) {
        // Stays until dismissed: a recipient who will never get the mail is
        // the one outcome that must not scroll away.
        new Notice(t().common.notice(t().mailNotices.sentRefused(result.rejected.join(", "))), 0);
        return;
      }
      new Notice(
        t().common.notice(result.filedInSent ? t().mailNotices.sent : t().mailNotices.sentNoCopy)
      );
    });
  }

  /**
   * Delivered: each `(fixed)` total is written into the note at what the
   * recipient got — the totals of the reading that was sent, carried with
   * the draft, so a note renamed or a send cancelled leaves nothing behind.
   * A failed write leaves the totals live and says so; the mail itself went,
   * and must not be reported otherwise.
   */
  private async freezeSent(file: TFile, freezes: readonly FreezeEntry[]): Promise<void> {
    try {
      await this.formulas.freeze(file, freezes);
    } catch (err) {
      this.logger.error("Email sent but its fixed totals could not be written:", err);
      new Notice(t().common.notice(t().sums.freezeFailed(file.path)));
    }
  }

  /**
   * A send whose outcome never came back. It is not called a failure — that
   * is what made a person send the mail a second time — and the note keeps a
   * mark of it, so the next send is warned even though no Message-ID arrived.
   */
  private async markUnconfirmed(file: TFile, err: unknown): Promise<void> {
    this.logger.error("send not confirmed:", err);
    const detail = err instanceof Error ? err.message : t().proofread.unknownError;

    new Notice(t().common.notice(t().mailNotices.sendUnconfirmed(detail)), 0);
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[FM_SEND_UNCONFIRMED] = new Date().toISOString();
      });
    } catch (writeErr) {
      this.logger.error(`${FM_SEND_UNCONFIRMED} could not be written:`, writeErr);
    }
  }

  async queryMailbox(): Promise<void> {
    const bridge = await this.requireBridge();
    if (!bridge) {
      return;
    }

    const settings = this.getSettings();
    new MailSearchModal(this.app, settings.mailMailbox, (criteria, options) => {
      void this.performQuery(bridge, criteria, options);
    }).open();
  }

  private async performQuery(
    bridge: MailBridgeConfig,
    criteria: SearchCriteria,
    options: SearchOptions = { withAttachments: false }
  ): Promise<void> {
    if (!hasCriteria(criteria)) {
      new Notice(t().common.notice(t().mailNotices.noCriteria));
      return;
    }

    await this.withBusy("search", async () => {
      const progress = new Notice(t().common.notice(t().mailNotices.searching), 0);

      let messages: MailMessage[];
      let truncated: boolean;
      try {
        ({ messages, truncated } = await this.runSearch(bridge, criteria));
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
      if (truncated) {
        new Notice(t().common.notice(t().mailNotices.searchTruncated(messages.length)));
      }

      new MailResultModal(this.app, messages, (message) => {
        if (options.withAttachments) {
          void this.importWithAttachments(bridge, message);
        } else {
          this.insertMessage(message);
        }
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

    const bridge = await this.requireBridge();
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
      let truncated: boolean;
      try {
        ({ messages, truncated } = await this.runSearch(
          bridge,
          { references: messageId },
          excludeFromMerged(fields.mergedIds)
        ));
      } catch (err) {
        this.fail("fetch replies", t().mailNotices.failSearch, err);
        return;
      } finally {
        progress.hide();
      }
      // Said whatever the merge brings: older replies are out of reach of this
      // fetch, and only the person can decide to fetch again.
      if (truncated) await this.sayRepliesTruncated(bridge);

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
          frontmatter[FM_MERGED_IDS] = mergedIdsAfter(
            frontmatter[FM_MERGED_IDS],
            fresh.map(mergeKey)
          );
        });
      } catch (err) {
        this.logger.error("Replies merged but merged_ids could not be updated:", err);
        new Notice(t().common.notice(t().mailNotices.mergedButIdsUnwritten(FM_MERGED_IDS)), 0);
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
    criteria: SearchCriteria,
    exclude: string[] = []
  ): Promise<{ messages: MailMessage[]; truncated: boolean }> {
    const settings = this.getSettings();
    const result = await searchMail(bridge, {
      criteria,
      mailbox: settings.mailMailbox,
      limit: settings.mailMaxResults,
      ...(exclude.length > 0 ? { exclude } : {})
    });

    if (result.truncated) {
      this.logger.info("Search hit the result limit; older matches were dropped.");
    }

    return { messages: result.messages, truncated: result.truncated };
  }

  /**
   * Say that a reply fetch left older matches behind. A bridge from protocol
   * 8 on steps past what the note holds, so fetching again reaches them; an
   * older one answers the same newest matches every time, and only an update
   * helps. Said in a notice that stays, since a log line is where it went
   * unread while a flood of mail kept the genuine replies out.
   */
  private async sayRepliesTruncated(bridge: MailBridgeConfig): Promise<void> {
    const speaks = await this.bridgeSpeaks(bridge, MAIL_EXCLUDE_PROTOCOL);
    const notices = t().mailNotices;
    new Notice(
      t().common.notice(speaks === "no" ? notices.repliesTruncatedOld : notices.repliesTruncated),
      0
    );
  }

  private insertMessage(message: MailMessage): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice(t().common.notice(t().mailNotices.needsEditor));
      return;
    }
    view.editor.replaceSelection(`${formatMessage(message)}\n`);
  }

  /**
   * Insert a mail with its files: saved where Obsidian puts attachments, and
   * embedded or linked under the quoted text. The mail goes into the note that
   * was open when it was chosen, or nowhere: files fetched for one note are
   * not linked from whichever note is open by the time they arrive. When the
   * files cannot come, the mail is inserted without them and that is said.
   */
  private async importWithAttachments(
    bridge: MailBridgeConfig,
    message: MailMessage
  ): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const note = view?.file;
    if (!view || !note) {
      new Notice(t().common.notice(t().mailNotices.needsEditor));
      return;
    }
    const insert = (files: string): void => {
      view.editor.replaceSelection(`${formatMessage(message)}\n${files ? `${files}\n` : ""}`);
    };

    await this.withBusy("attachments", async () => {
      const speaks = await this.bridgeSpeaks(bridge, MAIL_IMPORT_PROTOCOL);
      if (speaks !== "yes") {
        insert("");
        const notice = speaks === "no" ? "attachmentsTooOld" : "attachmentsUnknown";
        new Notice(t().common.notice(t().mailNotices[notice]), 0);
        return;
      }

      const progress = new Notice(t().common.notice(t().mailNotices.fetchingAttachments), 0);
      let result: AttachmentsResult;
      let links: { link: string; image: boolean }[];
      try {
        result = await fetchAttachments(bridge, {
          uid: message.uid,
          mailbox: this.getSettings().mailMailbox
        });
        links = await this.saveAttachments(result.attachments, note.path);
      } catch (err) {
        if (view.file?.path === note.path) insert("");
        this.fail("attachments", t().mailNotices.failAttachments, err);
        return;
      } finally {
        progress.hide();
      }

      if (view.file?.path !== note.path) {
        new Notice(t().common.notice(t().mailNotices.attachmentsNoteChanged), 0);
        return;
      }
      const words = t().mail;
      const skipped = result.skipped.map((entry) => ({
        filename: entry.filename,
        reason: words.skipReason[entry.reason]
      }));
      insert(attachmentQuoteLines(links, skipped, words.attachmentsSkipped));
      if (links.length > 0) {
        new Notice(t().common.notice(t().mailNotices.attachmentsSaved(links.length)));
      }
    });
  }

  /**
   * Write each file where Obsidian puts a new attachment for `sourcePath`, and
   * return the vault's own link to it. A file already there under the same
   * name with the same bytes is the same attachment imported before, and is
   * linked rather than copied again.
   */
  private async saveAttachments(
    attachments: readonly ImportedAttachment[],
    sourcePath: string
  ): Promise<{ link: string; image: boolean }[]> {
    const links: { link: string; image: boolean }[] = [];
    for (const attachment of attachments) {
      const available = await this.app.fileManager.getAvailablePathForAttachment(
        attachment.filename,
        sourcePath
      );
      const slash = available.lastIndexOf("/");
      const folder = slash >= 0 ? available.slice(0, slash) : "";
      const natural = folder ? `${folder}/${attachment.filename}` : attachment.filename;

      let file = await this.sameFile(natural, attachment.bytes);
      if (!file) {
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        file = await this.app.vault.createBinary(available, toArrayBuffer(attachment.bytes));
      }
      links.push({
        link: this.app.fileManager.generateMarkdownLink(file, sourcePath),
        image: isImageAttachment(file.name)
      });
    }
    return links;
  }

  private async sameFile(path: string, bytes: Uint8Array): Promise<TFile | null> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!(existing instanceof TFile) || existing.stat.size !== bytes.length) return null;
    const stored = new Uint8Array(await this.app.vault.readBinary(existing));
    return stored.every((byte, i) => byte === bytes[i]) ? existing : null;
  }

  private readFields(file: TFile): MailFields {
    return readMailFields(this.app.metadataCache.getFileCache(file)?.frontmatter);
  }

  /** The bridge, once its address is one this device sends the mail token to. */
  private async requireBridge(): Promise<MailBridgeConfig | null> {
    const settings = this.getSettings();

    const url = normalizeBaseUrl(settings.mailBridgeUrl);
    if (!url.ok) {
      new Notice(t().common.notice(url.message));
      return null;
    }

    const token = resolveApiKey(
      this.app.secretStorage,
      settings.mailTokenSecretName,
      t().secrets.mailToken
    );

    if (!token.ok) {
      new Notice(token.message);
      return null;
    }

    if (!(await confirmBridge(this.app, "mail", url.url))) {
      new Notice(t().common.notice(t().bridgeTrust.declined));
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
    const detail = err instanceof Error ? err.message : t().proofread.unknownError;
    new Notice(`${userMessage} — ${detail}`);
  }
}

/** The bytes as an ArrayBuffer of their own, which `createBinary` takes. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** One reading of the note: the draft, and what to freeze once it has gone. */
interface ReadDraft {
  draft: MailDraft;
  freezes: FreezeEntry[];
}

function confirmDetails(draft: MailDraft): MailConfirmDetails {
  return {
    from: draft.from,
    to: draft.fields.to,
    cc: draft.fields.cc,
    subject: draft.fields.subject,
    body: draft.body,
    warnings: sendWarnings(draft.fields, draft),
    attachments: draft.attachments.map((attachment) => attachment.filename),
    undrawn: draft.undrawn
  };
}

/** A diagram as it is kept between readings of the note. */
interface KeptFigure {
  pictures: { bytes: Uint8Array }[];
  title: string;
}
