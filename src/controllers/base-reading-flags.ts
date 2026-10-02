/**
 * Which bases open their notes for reading, as their files say.
 *
 * The answer is wanted at a press, which cannot wait for a file to be read,
 * and when a menu opens, which cannot either. So every base is read once the
 * vault is ready and again whenever one is written, created or renamed, and
 * the answers are kept here by path. What the key means and how it is
 * written is `services/bases-reading`.
 */
import { parseYaml, type App, type TAbstractFile, type TFile } from "obsidian";
import { MAX_BASE_FILE_BYTES, readsForReading, withReadingView } from "../services/bases-reading";
import type { Logger } from "../services/logger";

export function isBaseFile(file: TAbstractFile | null): file is TFile {
  return file !== null && "extension" in file && file.extension === "base";
}

export class BaseReadingFlags {
  private readonly reading = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly logger: Logger
  ) {}

  reads(file: TFile): boolean {
    return this.reading.has(file.path);
  }

  /** Every base in the vault, read once when the vault is ready. */
  async scan(): Promise<void> {
    for (const file of this.app.vault.getFiles()) {
      if (isBaseFile(file)) await this.read(file);
    }
  }

  /** One base, read again after it was written or created. */
  async read(file: TFile): Promise<void> {
    let on = false;
    if (file.stat.size <= MAX_BASE_FILE_BYTES) {
      try {
        on = readsForReading(parseYaml(await this.app.vault.cachedRead(file)));
      } catch (error) {
        // A base Obsidian cannot read either opens nothing; it is not this
        // plugin's to report.
        this.logger.debug(`bases: could not read ${file.path}`, error);
      }
    }
    if (on) this.reading.add(file.path);
    else this.reading.delete(file.path);
  }

  renamed(file: TAbstractFile, oldPath: string): void {
    const was = this.reading.delete(oldPath);
    if (was && isBaseFile(file)) this.reading.add(file.path);
  }

  deleted(path: string): void {
    this.reading.delete(path);
  }

  /**
   * Turn it on or off for one base, in its file, and answer which. The new
   * text must still read as YAML, with the key as asked, or nothing is
   * written: a base whose file the person broke stays as they left it.
   */
  async toggle(file: TFile): Promise<boolean> {
    const on = !this.reads(file);
    await this.app.vault.process(file, (text) => {
      const next = withReadingView(text, on);
      if (readsForReading(parseYaml(next)) !== on) {
        throw new Error("the base's file does not read as YAML");
      }
      return next;
    });
    if (on) this.reading.add(file.path);
    else this.reading.delete(file.path);
    return on;
  }
}
