import { TFile, type App } from "obsidian";
import { followedNotePath, retargetLinks } from "../services/description-follow";
import {
  matchOrphans,
  orphanFacts,
  picturesToHash,
  type OrphanFacts
} from "../services/description-orphans";
import type { DescriptionPairs } from "../services/description-pairs";
import { DESCRIPTION_KEYS, hashImageBytes } from "../services/image-description";
import { getImageMimeType } from "../services/image-resize";
import type { Logger } from "../services/logger";

export interface OrphanRepairResult {
  repaired: number;
  /** The notes still orphaned, for the person to look at. */
  remaining: string[];
}

/**
 * Re-links orphaned description notes to their picture by its content.
 *
 * Wiring only: which pictures are read and which matches are certain is decided
 * in `services/description-orphans`. A note is rewritten and renamed exactly as
 * one that followed its picture would have been; nothing is ever removed.
 */
export class OrphanRepair {
  private running: Promise<OrphanRepairResult> | null = null;

  constructor(
    private readonly app: App,
    private readonly pairs: () => DescriptionPairs,
    private readonly changed: () => void,
    private readonly logger: Logger
  ) {}

  /** One run at a time: the launch run and the command may overlap. */
  repair(): Promise<OrphanRepairResult> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<OrphanRepairResult> {
    const pairs = this.pairs();
    if (pairs.orphans.length === 0) return { repaired: 0, remaining: [] };

    const facts: OrphanFacts[] = [];
    for (const path of pairs.orphans) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const read = orphanFacts(path, frontmatter, DESCRIPTION_KEYS);
      if (read) facts.push(read);
    }

    // A picture that already has its description is not what an orphan lost.
    const pictures = this.app.vault
      .getFiles()
      .filter((file) => getImageMimeType(file.extension) !== null && !pairs.byImage.has(file.path))
      .map((file) => ({ path: file.path, size: file.stat.size }));

    const hashes = new Map<string, string>();
    for (const path of picturesToHash(facts, pictures)) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      try {
        hashes.set(path, hashImageBytes(new Uint8Array(await this.app.vault.readBinary(file))));
      } catch (error) {
        this.logger.warn(`Could not read ${path} to match a description:`, error);
      }
    }

    let repaired = 0;
    const fixed = new Set<string>();
    for (const plan of matchOrphans(facts, hashes)) {
      const note = this.app.vault.getAbstractFileByPath(plan.note);
      if (!(note instanceof TFile)) continue;
      try {
        await this.app.vault.process(note, (text) => retargetLinks(text, plan.link, plan.image));
        const next = followedNotePath(note.path, plan.link, plan.image);
        if (next !== null && !this.app.vault.getAbstractFileByPath(next)) {
          await this.app.fileManager.renameFile(note, next);
        }
        fixed.add(plan.note);
        repaired += 1;
      } catch (error) {
        this.logger.warn(`Could not re-link ${plan.note}:`, error);
      }
    }
    if (repaired > 0) this.changed();
    return { repaired, remaining: pairs.orphans.filter((path) => !fixed.has(path)) };
  }
}
