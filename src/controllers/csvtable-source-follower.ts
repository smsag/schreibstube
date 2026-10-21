import { TFile, TFolder, type App, type TAbstractFile } from "obsidian";
import { isCsvExtension } from "../services/csv-table";
import { mentionsCsvTable, retargetCsvTableSources } from "../services/csvtable-source";
import type { Logger } from "../services/logger";
import { pathAfterMove } from "../services/path-follow";

export interface CsvTableSourceHooks {
  /**
   * Notes would change: the block is another plugin's and the notes are the
   * person's, so nothing is written until they say so. `update` is the yes.
   */
  ask(notes: number, renamed: string, update: () => void): void;
  /** The notes the yes rewrote. */
  updated(notes: number): void;
}

/**
 * Offers to rewrite the `source:` of `csvtable` blocks when a CSV file, or a
 * folder holding one, is renamed.
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

    const notes: TFile[] = [];
    for (const note of this.app.vault.getMarkdownFiles()) {
      if (!this.mayHoldCode(note)) continue;
      try {
        const content = await this.app.vault.cachedRead(note);
        if (mentionsCsvTable(content) && retargetCsvTableSources(content, moved).changed > 0) {
          notes.push(note);
        }
      } catch (error) {
        this.logger.warn(`Could not read ${note.path} for its csvtable source:`, error);
      }
    }
    if (notes.length === 0) return;
    this.hooks.ask(notes.length, file.path, () => void this.update(notes, moved));
  }

  /**
   * The notes found at the rename, rewritten as they stand at the yes: one may
   * have been edited, moved or fixed by hand while the question waited.
   */
  private async update(notes: TFile[], moved: (path: string) => string | null): Promise<void> {
    let updated = 0;
    for (const note of notes) {
      if (!this.app.vault.getAbstractFileByPath(note.path)) continue;
      try {
        let changed = 0;
        await this.app.vault.process(note, (text) => {
          const result = retargetCsvTableSources(text, moved);
          changed = result.changed;
          return result.text;
        });
        if (changed > 0) updated++;
      } catch (error) {
        this.logger.warn(`Could not update the csvtable source in ${note.path}:`, error);
      }
    }
    if (updated > 0) this.hooks.updated(updated);
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
