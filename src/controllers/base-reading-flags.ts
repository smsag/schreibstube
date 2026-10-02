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

/** How many bases are read at once when the vault is ready. */
const READ_AT_ONCE = 8;

/** A base that does not parse asks for nothing, and is turned on from there. */
function parseYamlOrNull(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return null;
  }
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

  /** Every base in the vault, read once when the vault is ready, a few at a time. */
  async scan(): Promise<void> {
    const bases = this.app.vault.getFiles().filter(isBaseFile);
    for (let at = 0; at < bases.length; at += READ_AT_ONCE) {
      await Promise.all(bases.slice(at, at + READ_AT_ONCE).map((file) => this.read(file)));
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
   * Turn it on or off for one base, in its file, and answer which. Turned
   * from what the file says now rather than what was last read of it: before
   * the first scan reaches it, or after another device wrote it, the two can
   * differ, and the person asked to turn over what the file holds. The new
   * text must still read as YAML, with the key as asked, or nothing is
   * written: a base whose file the person broke stays as they left it.
   */
  async toggle(file: TFile): Promise<boolean> {
    // Set inside the edit, which is the only place the file's text is seen.
    const turned = { on: false };
    await this.app.vault.process(file, (text) => {
      turned.on = !readsForReading(parseYamlOrNull(text));
      const next = withReadingView(text, turned.on);
      if (readsForReading(parseYaml(next)) !== turned.on) {
        throw new Error("the base's file does not read as YAML");
      }
      return next;
    });
    const { on } = turned;
    if (on) this.reading.add(file.path);
    else this.reading.delete(file.path);
    return on;
  }
}
