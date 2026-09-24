import { t } from "../i18n";
import { Notice, TFile, type App } from "obsidian";
import type { PublishAccount, SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { resolveApiKey } from "../services/secret";
import { normalizeBaseUrl } from "../services/bridge-protocol";
import {
  bridgeHealth,
  commitPublish,
  listTargets,
  planPublish,
  uploadAsset,
  uploadSource
} from "../services/publish-client";
import {
  PROTOCOL_VERSION,
  isEmptyPlan,
  summarisePlan,
  type PublishAsset,
  type PublishBridgeConfig,
  type PublishIndex,
  type PublishNote
} from "../services/publish-protocol";
import {
  ATTACHMENT_EXTENSIONS,
  findSlugCollision,
  isInsideFolder,
  isPublishableAttachment,
  readPublishFields,
  referencedAttachments,
  resolveNote
} from "../services/publish-index";
import { PublishAccountModal, PublishPlanModal } from "../ui/publish-modals";

/**
 * The publish commands: preview a publish, run one, open the site.
 *
 * The plugin decides what is published and what each page is called; the bridge
 * renders the Markdown and writes it over SFTP. Splitting it that way is what
 * makes publishing work on mobile, where there is no Node runtime and no raw
 * socket to speak SSH over — and it keeps the hosting credentials out of the
 * vault entirely.
 *
 * A single in-flight guard prevents overlapping publishes, matching the mail
 * and LLM commands.
 */
export class PublishCommands {
  private busy = false;
  /** The handshake runs once per session, not once per request. */
  private handshakeDone = false;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly saveSettings: (patch: Partial<SchreibstubeSettings>) => Promise<void>,
    private readonly logger: Logger
  ) {}

  /** Show what a publish would do, and stop there. */
  async preview(): Promise<void> {
    await this.withAccount(async (account) => {
      const prepared = await this.prepare(account);
      if (!prepared) return;

      new PublishPlanModal(this.app, account, prepared.plan, null).open();
    });
  }

  /** Plan, confirm, upload, commit. */
  async publish(): Promise<void> {
    await this.withAccount(async (account) => {
      const prepared = await this.prepare(account);
      if (!prepared) return;

      new PublishPlanModal(this.app, account, prepared.plan, () => {
        void this.run(account, prepared);
      }).open();
    });
  }

  /** Open the published site in a browser. */
  async openSite(): Promise<void> {
    await this.withAccount(async (account) => {
      const bridge = this.requireBridge();
      if (!bridge) return;

      try {
        // The bridge knows the URL; the vault only knows a target name, which
        // is the point of keeping the hosting configuration on the bridge.
        const target = (await listTargets(bridge)).find((entry) => entry.name === account.target);
        if (!target) {
          new Notice(t().common.notice(t().publish.unknownTarget(account.target)));
          return;
        }
        window.open(target.baseUrl, "_blank");
      } catch (error) {
        new Notice(`Schreibstube: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private async run(account: PublishAccount, prepared: Prepared): Promise<void> {
    if (this.busy) {
      new Notice(t().common.notice(t().publish.busy));
      return;
    }
    this.busy = true;

    const notice = new Notice(t().common.notice(t().publish.running), 0);
    try {
      const { bridge, index, plan, sources, assets } = prepared;

      let done = 0;
      const total = plan.uploadSources.length + plan.uploadAssets.length;

      for (const entry of plan.uploadSources) {
        const content = sources.get(entry.sha256);
        if (!content) {
          throw new Error(t().publish.missingSource(entry.sourcePath));
        }
        await uploadSource(bridge, account.target, entry.sha256, content);
        done += 1;
        notice.setMessage(t().common.notice(t().publish.uploading(done, total)));
      }

      for (const entry of plan.uploadAssets) {
        const asset = assets.get(entry.sha256);
        if (!asset) {
          throw new Error(t().publish.missingSource(entry.sourcePath));
        }
        await uploadAsset(bridge, account.target, entry.sha256, asset.name, asset.content);
        done += 1;
        notice.setMessage(t().common.notice(t().publish.uploading(done, total)));
      }

      notice.setMessage(t().common.notice(t().publish.building));
      const summary = await commitPublish(bridge, account.target, index);

      notice.hide();
      new Notice(
        t().common.notice(t().publish.done(summary.written, summary.unchanged, summary.deleted))
      );
      this.logger.debug("Publish finished.", summary);

      // The notice is gone in seconds; the settings pane keeps the answer to
      // "did that go through".
      await this.recordRun(account, summary.written, summary.deleted);

      // Separate from the publish itself: the site is live either way, and a
      // failed note write must not be reported as a failed publish.
      await this.writeBack(account, index, summary.baseUrl);
    } catch (error) {
      notice.hide();
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t().common.notice(t().publish.failed(message)));
      this.logger.debug("Publish failed.", error);
    } finally {
      this.busy = false;
    }
  }

  /** Collect the folder, hash everything, and ask the bridge what it needs. */
  private async prepare(account: PublishAccount): Promise<Prepared | null> {
    const bridge = this.requireBridge();
    if (!bridge) return null;

    try {
      await this.checkBridgeVersion(bridge);
      const collected = await this.collect(account);
      if (!collected) return null;

      const plan = await planPublish(bridge, account.target, collected.index);
      this.logger.debug("Publish plan.", summarisePlan(plan));
      if (isEmptyPlan(plan)) {
        new Notice(t().common.notice(t().publish.noNotes(account.folder)));
        return null;
      }
      return { bridge, ...collected, plan };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Schreibstube: ${message}`);
      return null;
    }
  }

  /**
   * Everything in the folder that says it wants to be published.
   *
   * Only notes carrying the flag are read in full, and only the attachments
   * those notes actually refer to are loaded: an attachments folder is usually
   * larger than the notes, and none of the rest belongs on a public site.
   */
  private async collect(account: PublishAccount): Promise<Collected | null> {
    const keys = this.getSettings().publishFrontmatterKeys;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => isInsideFolder(file.path, account.folder))
      .sort((a, b) => a.path.localeCompare(b.path));

    // An index with no notes takes every page down. A folder with no notes at
    // all is far more often a mistyped setting, or a phone whose vault has not
    // synced yet, than a site meant to be emptied, so it never gets that far.
    if (files.length === 0) {
      new Notice(t().common.notice(t().publish.emptyFolder(account.folder)));
      return null;
    }

    const notes: PublishNote[] = [];
    const sources = new Map<string, ArrayBuffer>();
    const assets = new Map<string, { name: string; content: ArrayBuffer }>();
    const assetEntries: PublishAsset[] = [];
    const resolved = [];

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!readPublishFields(cache?.frontmatter, keys).published) continue;

      const content = await this.app.vault.read(file);
      const note = resolveNote(
        {
          path: file.path,
          basename: file.basename,
          content,
          createdMs: file.stat.ctime,
          frontmatter: cache?.frontmatter
        },
        keys
      );
      resolved.push(note);

      const bytes = new TextEncoder().encode(content);
      const sha256 = await hash(bytes);
      sources.set(sha256, bytes.buffer as ArrayBuffer);
      notes.push({ ...note, sha256 });

      for (const reference of referencedAttachments(content)) {
        const target = this.app.metadataCache.getFirstLinkpathDest(reference, file.path);
        if (!(target instanceof TFile)) continue;
        if (!isPublishableAttachment(target.name, ATTACHMENT_EXTENSIONS)) continue;
        if (assetEntries.some((entry) => entry.sourcePath === target.path)) continue;

        const data = await this.app.vault.readBinary(target);
        const assetHash = await hash(new Uint8Array(data));
        assets.set(assetHash, { name: target.name, content: data });
        assetEntries.push({
          sourcePath: target.path,
          sha256: assetHash,
          name: target.name,
          bytes: data.byteLength
        });
      }
    }

    const collision = findSlugCollision(resolved);
    if (collision) {
      new Notice(`Schreibstube: ${collision}`);
      return null;
    }

    const themeCss = await this.readTheme(account);
    const index: PublishIndex = {
      siteTitle: account.name,
      notes,
      assets: assetEntries,
      ...(themeCss !== undefined ? { themeCss } : {})
    };

    return { index, sources, assets };
  }

  private async recordRun(
    account: PublishAccount,
    written: number,
    deleted: number
  ): Promise<void> {
    await this.saveSettings({
      publishLastRun: {
        ...this.getSettings().publishLastRun,
        [account.id]: { at: new Date().toISOString(), written, deleted }
      }
    });
  }

  /** A `theme.css` in the publish folder replaces the built-in stylesheet. */
  private async readTheme(account: PublishAccount): Promise<string | undefined> {
    const path = account.folder ? `${account.folder}/theme.css` : "theme.css";
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? this.app.vault.read(file) : undefined;
  }

  /**
   * Record on each note that it was published, and where.
   *
   * In its own error boundary: the site is live by the time this runs, so a
   * failed write is a note that lost its receipt, not a failed publish.
   */
  private async writeBack(
    account: PublishAccount,
    index: PublishIndex,
    baseUrl: string
  ): Promise<void> {
    if (!account.writeBack) return;

    const keys = this.getSettings().publishFrontmatterKeys;
    const at = new Date().toISOString();
    for (const note of index.notes) {
      const file = this.app.vault.getAbstractFileByPath(note.sourcePath);
      if (!(file instanceof TFile)) continue;

      try {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter[keys.publishedAt] = at;
          frontmatter[keys.publishedUrl] = `${baseUrl}/${note.slug}/`;
        });
      } catch (error) {
        this.logger.debug(`Could not record the publish in ${note.sourcePath}.`, error);
        new Notice(t().common.notice(t().publish.writeBackFailed(note.sourcePath)));
      }
    }
  }

  /**
   * Say plainly when the bridge is behind the plugin.
   *
   * The two are deployed separately and will drift. Without this, an older
   * bridge answers a request for a route it does not have with a 404, which
   * reads as a wrong URL rather than as a missing redeploy.
   */
  private async checkBridgeVersion(bridge: PublishBridgeConfig): Promise<void> {
    if (this.handshakeDone) return;
    this.handshakeDone = true;

    try {
      const health = await bridgeHealth(bridge);
      if (health.protocol < PROTOCOL_VERSION) {
        new Notice(
          t().common.notice(t().publish.bridgeOutdated(health.protocol, PROTOCOL_VERSION))
        );
      }
    } catch (error) {
      // A bridge that cannot answer /health will fail the real request in a
      // moment, with a better message than anything this could add.
      this.logger.debug("Bridge health check failed.", error);
    }
  }

  /** One account needs no question; several do. */
  private async withAccount(work: (account: PublishAccount) => Promise<void>): Promise<void> {
    const accounts = this.getSettings().publishAccounts;

    if (accounts.length === 0) {
      new Notice(t().common.notice(t().publish.noAccount));
      return;
    }
    const [only] = accounts;
    if (accounts.length === 1 && only) {
      await work(only);
      return;
    }

    new PublishAccountModal(this.app, accounts, (account) => {
      void work(account);
    }).open();
  }

  /**
   * The bridge URL and token.
   *
   * The URL falls back to the mail bridge's, because the usual deployment is
   * one bridge offering both capabilities. The tokens never fall back: they are
   * separate on purpose, so a leaked publish token cannot read the mailbox.
   */
  private requireBridge(): PublishBridgeConfig | null {
    const settings = this.getSettings();
    const url = normalizeBaseUrl(settings.publishBridgeUrl || settings.mailBridgeUrl);
    if (!url.ok) {
      new Notice(`Schreibstube: ${url.message}`);
      return null;
    }

    const token = resolveApiKey(
      this.app.secretStorage,
      settings.publishTokenSecretName,
      t().secrets.publishToken
    );
    if (!token.ok) {
      new Notice(token.message);
      return null;
    }

    return { baseUrl: url.url, token: token.apiKey };
  }
}

interface Collected {
  index: PublishIndex;
  sources: Map<string, ArrayBuffer>;
  assets: Map<string, { name: string; content: ArrayBuffer }>;
}

interface Prepared extends Collected {
  bridge: PublishBridgeConfig;
  plan: Awaited<ReturnType<typeof planPublish>>;
}

/** Web Crypto is present in both Obsidian runtimes, desktop and mobile. */
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
