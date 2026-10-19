import { t } from "../i18n";
import { Notice, TFile, type App } from "obsidian";
import type { PublishAccount, SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { createShare, listShares, revokeShare } from "../platform/publish-client";
import type { PublishBridgeConfig } from "../services/publish-protocol";
import { resolveNote } from "../services/publish-index";
import { sourceForUpload } from "../services/publish-source";
import {
  bytesToBase64,
  linksOfNote,
  pickShareAssets,
  shareAccountFor,
  shareReferences,
  type ShareCandidate,
  type SharedLink
} from "../services/share-link";
import { PublishAccountModal } from "../ui/publish-modals";
import { ShareListModal, ShareModal, ShareResultModal, type ShareChoice } from "../ui/share-modals";
import type { PublishCommands } from "./publish-commands";
import { NO_FORMULAS, type NoteFormulas } from "./sums-controller";

/** Told each time the plugin learns a target's whole list of links. */
export type ShareListener = (target: string, links: readonly SharedLink[]) => void;

/**
 * Shared links: one note at a short address under a publish account's site.
 *
 * The bridge, its token and the target are publishing's; a note need not be
 * in the account's folder, since the point is a document that is not part of
 * the site. The note is read when the link is written and not again: a link
 * shows what was sent, and updating it is asking to send again.
 */
export class ShareCommands {
  private busy = false;
  private formulas: NoteFormulas = NO_FORMULAS;
  private listener: ShareListener = () => {};

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly publish: PublishCommands,
    private readonly logger: Logger
  ) {}

  /** Who keeps a copy of the lists: the file pane, which marks shared notes. */
  useListener(listener: ShareListener): void {
    this.listener = listener;
  }

  /** A note's formulas, resolved in what is sent, as a publish resolves them. */
  useFormulas(formulas: NoteFormulas): void {
    this.formulas = formulas;
  }

  async shareActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice(t().common.notice(t().share.noNote));
      return;
    }
    await this.withAccount(file.path, async (account) => {
      const bridge = await this.connect();
      if (!bridge) return;
      const links = await this.list(bridge, account);
      if (!links) return;

      new ShareModal(
        this.app,
        file.basename,
        linksOfNote(links, file.path),
        (choice) => void this.guarded(() => this.share(bridge, account, file, choice, links)),
        (link) => void this.guarded(() => this.revoke(bridge, account, link, links))
      ).open();
    });
  }

  async manageShares(): Promise<void> {
    await this.withAccount(null, async (account) => {
      const bridge = await this.connect();
      if (!bridge) return;
      const links = await this.list(bridge, account);
      if (!links) return;
      // The list the dialog shows, as revokes leave it.
      let open: readonly SharedLink[] = links;
      new ShareListModal(
        this.app,
        account.name,
        [...links],
        async (link) => {
          const done = await this.guarded(() => this.revoke(bridge, account, link, open));
          if (done) open = open.filter((entry) => entry.code !== link.code);
          return done ?? false;
        },
        this.logger
      ).open();
    });
  }

  /** The target's links, and the file pane told of them. */
  private async list(
    bridge: PublishBridgeConfig,
    account: PublishAccount
  ): Promise<SharedLink[] | null> {
    const links = await this.guarded(() => listShares(bridge, account.target));
    if (links) this.listener(account.target, links);
    return links;
  }

  private async share(
    bridge: PublishBridgeConfig,
    account: PublishAccount,
    file: TFile,
    choice: ShareChoice,
    known: readonly SharedLink[]
  ): Promise<void> {
    const notice = new Notice(t().common.notice(t().share.working), 0);
    try {
      const content = (await this.formulas.forExport(await this.app.vault.read(file))).text;
      const note = resolveNote(
        {
          path: file.path,
          basename: file.basename,
          content,
          createdMs: file.stat.ctime,
          frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter
        },
        this.getSettings().publishFrontmatterKeys
      );

      const { carried, left } = pickShareAssets(this.candidates(content, file.path));
      const assets = [];
      for (const candidate of carried) {
        const target = this.app.vault.getAbstractFileByPath(candidate.path);
        if (!(target instanceof TFile)) continue;
        const bytes = new Uint8Array(await this.app.vault.readBinary(target));
        assets.push({ sourcePath: candidate.path, data: bytesToBase64(bytes) });
      }
      const themeCss = await this.publish.readTheme(account);

      const link = await createShare(bridge, {
        target: account.target,
        ...(choice.code ? { code: choice.code } : {}),
        title: note.title,
        sourcePath: file.path,
        // What a page never shows stays in the vault, as for a publish.
        source: sourceForUpload(content),
        assets,
        ...(choice.password ? { password: choice.password } : {}),
        expiresAt: choice.expiresAt,
        ...(themeCss !== undefined ? { themeCss } : {})
      });
      notice.hide();
      this.listener(account.target, [...known.filter((entry) => entry.code !== link.code), link]);
      if (left.length > 0) new Notice(t().common.notice(t().share.left(left)), 10_000);
      new ShareResultModal(this.app, link, choice.password, this.logger).open();
    } catch (error) {
      notice.hide();
      throw error;
    }
  }

  /** The files the note embeds, with their size, in the order it embeds them. Notes are not files to carry. */
  private candidates(content: string, sourcePath: string): ShareCandidate[] {
    const found: ShareCandidate[] = [];
    for (const reference of shareReferences(content)) {
      const target = this.app.metadataCache.getFirstLinkpathDest(reference, sourcePath);
      if (target instanceof TFile && target.extension !== "md") {
        found.push({ path: target.path, bytes: target.stat.size });
      }
    }
    return found;
  }

  private async revoke(
    bridge: PublishBridgeConfig,
    account: PublishAccount,
    link: SharedLink,
    known: readonly SharedLink[]
  ): Promise<boolean> {
    const complete = await revokeShare(bridge, account.target, link.code);
    // Down either way: a file left behind is the bridge's to retry, not a link.
    this.listener(
      account.target,
      known.filter((entry) => entry.code !== link.code)
    );
    new Notice(t().common.notice(complete ? t().share.revoked : t().share.revokeLeft));
    return true;
  }

  private async connect(): Promise<PublishBridgeConfig | null> {
    const bridge = await this.publish.requireBridge();
    if (bridge) await this.publish.checkBridgeVersion(bridge);
    return bridge;
  }

  /** One request at a time, and a failure said rather than thrown into a click. */
  private async guarded<T>(work: () => Promise<T>): Promise<T | null> {
    if (this.busy) {
      new Notice(t().common.notice(t().share.busy));
      return null;
    }
    this.busy = true;
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t().common.notice(t().share.failed(message)));
      this.logger.debug("Share failed.", error);
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** The account `shareAccountFor` names, or the one the person picks. */
  private async withAccount(
    path: string | null,
    work: (account: PublishAccount) => Promise<void>
  ): Promise<void> {
    const accounts = this.getSettings().publishAccounts;
    if (accounts.length === 0) {
      new Notice(t().common.notice(t().publish.noAccount));
      return;
    }
    const chosen = shareAccountFor(accounts, path);
    if (chosen) {
      await work(chosen);
      return;
    }
    new PublishAccountModal(this.app, accounts, (account) => void work(account)).open();
  }
}
