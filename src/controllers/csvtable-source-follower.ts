import { TFile, TFolder, type App, type TAbstractFile } from "obsidian";
import { isCsvExtension } from "../services/csv-table";
import { mentionsCsvTable, retargetCsvTableSources } from "../services/csvtable-source";
import type { Logger } from "../services/logger";
import { pathAfterMove } from "../services/path-follow";

export interface CsvTableSourceHooks {
  /** Notes were rewritten: say so, since nobody asked for the write. */
  updated(notes: number): void;
}

/**
 * Rewrites the `source:` of `csvtable` blocks when a CSV file, or a folder
 * holding one, is renamed.
 *
 * Wiring only; which line holds the path and how it is written back are
 * decided in `services/csvtable-source`.
 */
export class CsvTableSourceFollower {
  constructor(
    private readonly app: App,
    private readonly hooks: CsvTableSourceHooks,
    private readonly logger: Logger
  ) {}

  async renamed(file: TAbstractFile, oldPath: string): Promise<void> {
    const moves = new Map<string, string>();
    for (const csv of this.csvFilesOf(file)) {
      // A folder's children already carry their new paths when the event arrives.
      moves.set(pathAfterMove(csv.path, file.path, oldPath), csv.path);
    }
    if (moves.size === 0) return;
    const moved = (path: string) => moves.get(path) ?? null;

    let notes = 0;
    for (const note of this.app.vault.getMarkdownFiles()) {
      if (!this.mayHoldCode(note)) continue;
      try {
        const content = await this.app.vault.cachedRead(note);
        if (!mentionsCsvTable(content) || retargetCsvTableSources(content, moved).changed === 0) {
          continue;
        }
        await this.app.vault.process(note, (text) => retargetCsvTableSources(text, moved).text);
        notes++;
      } catch (error) {
        this.logger.warn(`Could not update the csvtable source in ${note.path}:`, error);
      }
    }
    if (notes > 0) this.hooks.updated(notes);
  }

  /**
   * A note the metadata cache says has no code block is not read: a rename
   * would otherwise read every note in the vault. A note the cache has not
   * parsed yet is read rather than guessed about.
   */
  private mayHoldCode(note: TFile): boolean {
    const sections = this.app.metadataCache.getFileCache(note)?.sections;
    return sections === undefined || sections.some((section) => section.type === "code");
  }

  private csvFilesOf(file: TAbstractFile): TFile[] {
    if (file instanceof TFile) return isCsvExtension(file.extension) ? [file] : [];
    if (!(file instanceof TFolder)) return [];
    return file.children.flatMap((child) => this.csvFilesOf(child));
  }
}
