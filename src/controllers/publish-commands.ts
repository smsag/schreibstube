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
  uploadSource,
  uploadThumbnail
} from "../services/publish-client";
import {
  PROTOCOL_VERSION,
  isEmptyPlan,
  summarisePlan,
  type PublishAsset,
  type PublishBridgeConfig,
  type PublishIndex,
  type PublishNote,
  type UploadRequest
} from "../services/publish-protocol";
import {
  isSendableThumbnail,
  THUMBNAIL_MAX_PX,
  THUMBNAIL_QUALITY,
  thumbnailType
} from "../services/publish-thumbnail";
import { getImageMimeType, resizeImageToBytes } from "../services/image-resize";
import {
  ATTACHMENT_EXTENSIONS,
  findSlugCollision,
  isInsideFolder,
  isPublishableAttachment,
  readPublishFields,
  headerTagsOf,
  noteTags,
  referencedAttachments,
  resolveNote,
  slideshowReferences
} from "../services/publish-index";
import {
  diagramAlt,
  diagramAssetName,
  diagramKeyInput,
  DrawnDiagrams,
  findDiagramFences,
  MAX_PUBLISHED_DIAGRAM_BYTES,
  replaceDiagramFences,
  type DiagramFence,
  type DrawnDiagram,
  type DrawnPicture
} from "../services/publish-diagrams";
import { PublishAccountModal, PublishPlanModal } from "../ui/publish-modals";
import { toArrayBuffer } from "../utils/array-buffer";
import { mapLimit } from "../utils/map-limit";
import { sha256 as hash } from "../utils/sha256";
import { DiagramCapture } from "./diagram-capture";
import { NO_FORMULAS, type NoteFormulas } from "./sums-controller";

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
  private readonly diagrams: DiagramCapture;
  /** Canvases drawn for an earlier publish in this session, by content. */
  private readonly drawn = new DrawnDiagrams();
  private formulas: NoteFormulas = NO_FORMULAS;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly saveSettings: (patch: Partial<SchreibstubeSettings>) => Promise<void>,
    private readonly logger: Logger
  ) {
    this.diagrams = new DiagramCapture(app, logger, "publish", MAX_PUBLISHED_DIAGRAM_BYTES);
  }

  /** A note's formulas: resolved in what is uploaded, and `(fixed)` ones frozen once it is live. */
  useFormulas(formulas: NoteFormulas): void {
    this.formulas = formulas;
  }

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
      const total =
        plan.uploadSources.length + plan.uploadAssets.length + plan.uploadThumbnails.length;
      const uploaded = (): void => {
        done += 1;
        notice.setMessage(t().common.notice(t().publish.uploading(done, total)));
      };

      // A few at a time: over a phone's connection each upload is mostly
      // waiting, and one after another a first publish took minutes — long
      // enough for the phone to suspend the app in the middle of it.
      await mapLimit(plan.uploadSources, UPLOAD_CONCURRENCY, async (entry) => {
        const content = sources.get(entry.sha256);
        if (!content) {
          throw new Error(t().publish.missingSource(entry.sourcePath));
        }
        await uploadSource(bridge, account.target, entry.sha256, content);
        uploaded();
      });

      await mapLimit(plan.uploadAssets, UPLOAD_CONCURRENCY, async (entry) => {
        const asset = assets.get(entry.sha256);
        if (!asset) {
          throw new Error(t().publish.missingSource(entry.sourcePath));
        }
        // A drawn canvas is no file in the vault; its bytes were kept instead.
        const content = asset.bytes
          ? toArrayBuffer(asset.bytes)
          : await this.readAttachment(asset.path, entry.sha256);
        await uploadAsset(bridge, account.target, entry.sha256, asset.name, content);
        uploaded();
      });

      // One at a time: each is a photograph decoded in full, and two at once
      // is twice the memory a phone may not have. A thumbnail that cannot be
      // made or sent is left out — the filmstrip shows the picture itself,
      // and the next publish asks again — rather than failing the publish.
      await mapLimit(plan.uploadThumbnails, 1, async (entry) => {
        const asset = assets.get(entry.sha256);
        if (asset) {
          try {
            await this.sendThumbnail(bridge, account.target, entry, asset);
          } catch (error) {
            this.logger.debug(`Thumbnail skipped for ${entry.sourcePath}.`, error);
          }
        }
        uploaded();
      });

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
      await this.freezePublished(index);
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

  /** Make the filmstrip thumbnail of one picture, and send it if it is small enough. */
  private async sendThumbnail(
    bridge: PublishBridgeConfig,
    target: string,
    entry: UploadRequest,
    asset: { name: string; path: string }
  ): Promise<void> {
    const type = thumbnailType(asset.name);
    if (!type) return;
    const content = await this.readAttachment(asset.path, entry.sha256);
    const extension = asset.name.split(".").pop() ?? "";
    const { bytes } = await resizeImageToBytes(
      content,
      getImageMimeType(extension) ?? type,
      THUMBNAIL_MAX_PX,
      THUMBNAIL_QUALITY,
      type
    );
    if (!isSendableThumbnail(bytes.byteLength)) return;
    const body = bytes.slice().buffer as ArrayBuffer;
    await uploadThumbnail(bridge, target, entry.sha256, asset.name, await hash(bytes), body);
  }

  /**
   * An attachment's bytes, read again for its upload.
   *
   * The file may have changed since the plan hashed it. Sent as it is now, it
   * would be refused for not matching the hash the bridge was promised, and
   * the site would be built on a picture that is no longer the vault's; so the
   * run stops and says which file moved under it.
   */
  private async readAttachment(path: string, sha256: string): Promise<ArrayBuffer> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(t().publish.missingSource(path));
    const content = await this.app.vault.readBinary(file);
    if ((await hash(new Uint8Array(content))) !== sha256) {
      throw new Error(t().publish.changedDuringPublish(path));
    }
    return content;
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
    const assets = new Map<string, CollectedAsset>();
    const assetEntries: PublishAsset[] = [];
    const resolved = [];

    // Read first, so that the canvases of every note can be counted before
    // the first is drawn: drawing takes long enough to want a count.
    const published = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!readPublishFields(cache?.frontmatter, keys).published) continue;
      const content = await this.formulas.forExport(await this.app.vault.read(file));
      published.push({ file, cache, content, fences: findDiagramFences(content) });
    }
    const drawing = new DrawingProgress(
      published.reduce((sum, entry) => sum + entry.fences.length, 0)
    );

    try {
      for (const { file, cache, content, fences } of published) {
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

        // The copy that is uploaded shows each canvas as the picture drawn of it.
        const uploaded = await this.withDiagrams(content, fences, file.path, drawing);
        for (const picture of uploaded.pictures) {
          if (assets.has(picture.sha256)) continue;
          assets.set(picture.sha256, {
            name: picture.name,
            path: picture.name,
            bytes: picture.bytes
          });
          assetEntries.push({
            sourcePath: picture.name,
            sha256: picture.sha256,
            name: picture.name,
            bytes: picture.bytes.byteLength
          });
        }

        const bytes = new TextEncoder().encode(uploaded.content);
        const sha256 = await hash(bytes);
        sources.set(sha256, bytes.buffer as ArrayBuffer);
        const carried =
          account.headerTags.length > 0 ? headerTagsOf(noteTags(cache), account.headerTags) : [];
        notes.push({ ...note, sha256, ...(carried.length > 0 ? { tags: carried } : {}) });

        // A filmstrip shows its pictures small as well, and asks for thumbnails.
        const filmstrip = new Set(
          slideshowReferences(content, "filmstrip")
            .map((reference) => this.app.metadataCache.getFirstLinkpathDest(reference, file.path))
            .filter((target): target is TFile => target instanceof TFile)
            .map((target) => target.path)
        );

        for (const reference of referencedAttachments(content)) {
          const target = this.app.metadataCache.getFirstLinkpathDest(reference, file.path);
          if (!(target instanceof TFile)) continue;
          if (!isPublishableAttachment(target.name, ATTACHMENT_EXTENSIONS)) continue;
          const wantsThumbnail = filmstrip.has(target.path) && thumbnailType(target.name) !== null;
          const known = assetEntries.find((entry) => entry.sourcePath === target.path);
          if (known) {
            // Shown plainly in one note and in a filmstrip in another.
            if (wantsThumbnail) known.thumbnail = true;
            continue;
          }

          // Read to be hashed, then let go: the bytes are read again only if
          // the bridge asks for them. Kept for the whole run, every picture a
          // site shows sat in memory at once, which a phone's WebView does not
          // survive for long.
          const data = await this.app.vault.readBinary(target);
          const assetHash = await hash(new Uint8Array(data));
          assets.set(assetHash, { name: target.name, path: target.path });
          assetEntries.push({
            sourcePath: target.path,
            sha256: assetHash,
            name: target.name,
            bytes: data.byteLength,
            ...(wantsThumbnail ? { thumbnail: true } : {})
          });
        }
      }
    } finally {
      // A read that fails partway must not leave the count on screen for ever.
      drawing.finish();
    }
    if (drawing.lost > 0) {
      new Notice(t().common.notice(t().publish.diagramsNotDrawn(drawing.lost)), 10_000);
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
      ...(themeCss !== undefined ? { themeCss } : {}),
      ...(account.headerTags.length > 0 ? { headerTags: account.headerTags } : {})
    };

    return { index, sources, assets };
  }

  /**
   * A note's text as it is uploaded: each canvas that could be drawn replaced
   * by its pictures, and the pictures themselves.
   *
   * A canvas is drawn whole or not at all. One whose panels partly failed stays
   * its source rather than being published a panel short, which nothing on
   * the page would admit to.
   */
  private async withDiagrams(
    content: string,
    fences: readonly DiagramFence[],
    sourcePath: string,
    drawing: DrawingProgress
  ): Promise<{ content: string; pictures: DrawnPicture[] }> {
    if (fences.length === 0) return { content, pictures: [] };

    const placed = new Map<number, { name: string; alt: string }[]>();
    const pictures: DrawnPicture[] = [];
    for (const fence of fences) {
      drawing.next();
      const diagram = await this.drawDiagram(fence, sourcePath);
      if (!diagram) {
        drawing.lost += 1;
        continue;
      }
      placed.set(
        fence.index,
        diagram.pictures.map((picture) => ({ name: picture.name, alt: diagram.alt }))
      );
      pictures.push(...diagram.pictures);
    }
    return { content: replaceDiagramFences(content, fences, placed), pictures };
  }

  /** One canvas's pictures, drawn now or kept from an earlier publish. */
  private async drawDiagram(fence: DiagramFence, sourcePath: string): Promise<DrawnDiagram | null> {
    const key = await hash(new TextEncoder().encode(diagramKeyInput(fence)));
    const kept = this.drawn.get(key);
    if (kept) return kept;

    const capture = await this.diagrams.capture(fence, sourcePath);
    if (capture.pictures.length === 0 || capture.pictures.length < capture.expected) return null;

    const pictures = await Promise.all(
      capture.pictures.map(async (bytes, panel) => ({
        name: diagramAssetName(key, panel),
        sha256: await hash(bytes),
        bytes
      }))
    );
    const diagram = { pictures, alt: diagramAlt(capture.title, t().publish.diagramAlt) };
    this.drawn.set(key, diagram);
    return diagram;
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
   * The site is live: each `(fixed)` total is written into its note at what
   * the site now shows. In its own error boundary, as the write-back is.
   */
  private async freezePublished(index: PublishIndex): Promise<void> {
    for (const note of index.notes) {
      const file = this.app.vault.getAbstractFileByPath(note.sourcePath);
      if (!(file instanceof TFile)) continue;
      try {
        await this.formulas.freeze(file);
      } catch (error) {
        this.logger.debug(`Could not freeze the totals in ${note.sourcePath}.`, error);
        new Notice(t().common.notice(t().sums.freezeFailed(note.sourcePath)));
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
  /** Where each attachment is, by hash — never its bytes, which can be large. */
  assets: Map<string, CollectedAsset>;
}

interface CollectedAsset {
  name: string;
  path: string;
  /** A drawn canvas, which is no file to read again: its bytes, bounded. */
  bytes?: Uint8Array;
}

/**
 * The notice that counts canvases while they are drawn.
 *
 * Shown only once there is something to draw, so a site without a canvas
 * publishes exactly as it did.
 */
class DrawingProgress {
  lost = 0;
  private drawn = 0;
  private notice: Notice | null = null;

  constructor(private readonly total: number) {}

  next(): void {
    this.drawn += 1;
    const message = t().common.notice(t().publish.drawingDiagrams(this.drawn, this.total));
    if (this.notice) this.notice.setMessage(message);
    else this.notice = new Notice(message, 0);
  }

  finish(): void {
    this.notice?.hide();
    this.notice = null;
  }
}

/**
 * Uploads in flight at once. Few, because the bytes of each are in memory
 * until it is sent, and a video may weigh 25 MB on a phone.
 */
const UPLOAD_CONCURRENCY = 3;

interface Prepared extends Collected {
  bridge: PublishBridgeConfig;
  plan: Awaited<ReturnType<typeof planPublish>>;
}
