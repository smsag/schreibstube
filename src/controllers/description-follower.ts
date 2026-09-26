import { TFile, type App, type TAbstractFile } from "obsidian";
import { linkTarget } from "../services/description-pairs";
import { followedNotePath, linkPointedAt, retargetLinks } from "../services/description-follow";
import { DESCRIPTION_KEYS } from "../services/image-description";
import type { Logger } from "../services/logger";

/**
 * How long after a rename the note is looked at again. Obsidian rewrites links
 * after the rename event, when its own setting says to; a note it already fixed
 * is then left alone rather than written twice.
 */
export const FOLLOW_RENAME_DELAY_MS = 1000;

/**
 * How long after a delete the note waits before going to the trash.
 *
 * A sync client often moves a file as a delete here and a create there, and the
 * note rewritten on the other device may arrive a few seconds later. A picture
 * back at its path, or a note whose link works again, is then left alone.
 */
export const FOLLOW_DELETE_DELAY_MS = 10_000;

interface Pointing {
  note: TFile;
  /** The link as it stood in the frontmatter when the picture moved. */
  link: string;
  /** Whether that link broke with the move, and so is Schreibstube's to fix. */
  broken: boolean;
}

export interface DescriptionFollowerHooks {
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** The pairing changed: the pane forgets it and redraws. */
  changed(): void;
}

/**
 * Keeps a description note with its picture: rewrites its link and renames it
 * when the picture moves, and trashes it when the picture is deleted.
 *
 * Wiring only; which link pointed where and what the note is renamed to are
 * decided in `services/description-follow`.
 */
export class DescriptionFollower {
  private readonly timers = new Set<unknown>();

  constructor(
    private readonly app: App,
    private readonly hooks: DescriptionFollowerHooks,
    private readonly logger: Logger
  ) {}

  /** The notes about the file that is, or was, at `path`. */
  private notesAbout(path: string, current: string | null): Pointing[] {
    const out: Pointing[] = [];
    for (const note of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(note)?.frontmatter;
      if (!frontmatter || !(DESCRIPTION_KEYS.image in frontmatter)) continue;
      const link = linkTarget(frontmatter[DESCRIPTION_KEYS.image]);
      if (link === null) continue;
      const resolved = this.app.metadataCache.getFirstLinkpathDest(link, note.path);
      if (current !== null && resolved?.path === current) {
        out.push({ note, link, broken: false });
      } else if (linkPointedAt(link, path, resolved !== null)) {
        out.push({ note, link, broken: true });
      }
    }
    return out;
  }

  private later(ms: number, run: () => Promise<void>): void {
    const handle = this.hooks.setTimer(() => {
      this.timers.delete(handle);
      void run()
        .catch((error: unknown) =>
          this.logger.warn("Could not update a picture's description:", error)
        )
        .finally(() => this.hooks.changed());
    }, ms);
    this.timers.add(handle);
  }

  pictureRenamed(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile) || file.extension === "md") return;
    const found = this.notesAbout(oldPath, file.path);
    if (found.length === 0) return;
    this.later(FOLLOW_RENAME_DELAY_MS, async () => {
      for (const { note, link, broken } of found) {
        if (!this.app.vault.getAbstractFileByPath(note.path)) continue;
        // The text, not the metadata cache, decides: the cache is reparsed a
        // moment after Obsidian's own rewrite, and writing on its stale word
        // would race that rewrite.
        if (broken && !this.linksTo(note, file.path)) {
          const content = await this.app.vault.cachedRead(note);
          if (retargetLinks(content, link, file.path) !== content) {
            await this.app.vault.process(note, (text) => retargetLinks(text, link, file.path));
          }
        }
        const next = followedNotePath(note.path, oldPath, file.path);
        if (next !== null && !this.app.vault.getAbstractFileByPath(next)) {
          await this.app.fileManager.renameFile(note, next);
        }
      }
    });
  }

  pictureDeleted(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension === "md") return;
    const path = file.path;
    const found = this.notesAbout(path, null);
    if (found.length === 0) return;
    this.later(FOLLOW_DELETE_DELAY_MS, async () => {
      if (this.app.vault.getAbstractFileByPath(path)) return;
      for (const { note } of found) {
        if (!this.app.vault.getAbstractFileByPath(note.path)) continue;
        // Its link works again: the picture arrived elsewhere and the note
        // was rewritten, on this device or another.
        if (this.pointsSomewhere(note)) continue;
        // Trashed, never erased: which trash is the person's own setting.
        await this.app.fileManager.trashFile(note);
      }
    });
  }

  private currentLink(note: TFile): string | null {
    const frontmatter = this.app.metadataCache.getFileCache(note)?.frontmatter;
    return frontmatter ? linkTarget(frontmatter[DESCRIPTION_KEYS.image]) : null;
  }

  private linksTo(note: TFile, path: string): boolean {
    const link = this.currentLink(note);
    return (
      link !== null && this.app.metadataCache.getFirstLinkpathDest(link, note.path)?.path === path
    );
  }

  private pointsSomewhere(note: TFile): boolean {
    const link = this.currentLink(note);
    return link !== null && this.app.metadataCache.getFirstLinkpathDest(link, note.path) !== null;
  }

  stop(): void {
    for (const handle of this.timers) this.hooks.clearTimer(handle);
    this.timers.clear();
  }
}
