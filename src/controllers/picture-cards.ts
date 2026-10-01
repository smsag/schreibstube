/**
 * Pictures from a base as cards that open the article they appear in.
 *
 * Which picture a row stands for and which notes it appears in is decided in
 * `services/picture-cards`; this hands that module what the vault knows and
 * opens what a card asks for. An article opens in Reading view unless the
 * base switches that off: a person coming back to a picture they kept comes
 * to read the piece it was in, and an editor's cursor is one stray tap from
 * changing it.
 */
import { Platform, type App } from "obsidian";
import { basename } from "../services/file-name";
import { isImageName } from "../services/folder-images";
import { availableTarget, type PaneTarget } from "../services/pane-target";
import type { PictureCardSources } from "../services/picture-cards";
import { backlinkIndex } from "../services/related-notes";

/** What the Explorer already keeps about description notes. */
export interface PictureCardsHooks {
  imageDescribedBy(notePath: string): string | null;
  isDescriptionNote(path: string): boolean;
  displayTitle(path: string): string | null;
}

export class PictureCardsController {
  constructor(
    private readonly app: App,
    private readonly hooks: PictureCardsHooks
  ) {}

  /**
   * The vault as the cards are decided against, read once per drawing.
   * Obsidian offers no public call for a file's backlinks, and inverting the
   * link table once answers every card; asking per card walked it per card.
   */
  sources(): PictureCardSources {
    const referrers = backlinkIndex(this.app.metadataCache.resolvedLinks);
    return {
      imageDescribedBy: (path) => this.hooks.imageDescribedBy(path),
      isPicture: (path) => isImageName(basename(path)),
      isDescriptionNote: (path) => this.hooks.isDescriptionNote(path),
      referrers: (path) => referrers.get(path) ?? [],
      modifiedAt: (path) => this.app.vault.getFileByPath(path)?.stat.mtime ?? 0
    };
  }

  /** What a card calls a note: its title when it has one, else its name. */
  title(path: string): string {
    return this.hooks.displayTitle(path) ?? basename(path).replace(/\.md$/i, "");
  }

  /** The URL an <img> can load a picture from, or null when it is not there. */
  resourceUrl(path: string): string | null {
    const file = this.app.vault.getFileByPath(path);
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  /** In Reading view when the base asks for it, else as Obsidian would open it. */
  async openArticle(path: string, where: PaneTarget, reading: boolean): Promise<void> {
    await this.open(path, where, reading ? { state: { mode: "preview" } } : {});
  }

  /** A picture or a description note, the way Obsidian would open it. */
  async openFile(path: string, where: PaneTarget): Promise<void> {
    await this.open(path, where, {});
  }

  private async open(
    path: string,
    where: PaneTarget,
    state: { state?: Record<string, unknown> }
  ): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    const leaf = this.app.workspace.getLeaf(availableTarget(where, Platform.isDesktopApp));
    await leaf.openFile(file, state);
  }
}
