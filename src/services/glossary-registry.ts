/**
 * Loads glossary notes out of the vault and keeps them parsed.
 *
 * Candidates are found through Obsidian's metadata cache rather than by reading
 * every note, so listing them for the picker costs nothing. Parsed glossaries
 * are cached per file and invalidated on modification time, which keeps a
 * glossary edit live without re-parsing on every keystroke of the note under
 * review.
 */

import type { App, TFile } from "obsidian";
import {
  GLOSSARY_MARKER,
  parseGlossary,
  type Glossary,
  type GlossaryParseResult
} from "./glossary-parser";

export interface GlossaryCandidate {
  path: string;
  /** Basename, for the picker chip. */
  name: string;
}

export interface LoadedGlossaries {
  glossaries: Glossary[];
  /** Parse problems, prefixed with the file they came from. */
  errors: string[];
  /** Selected paths that no longer resolve to a note. */
  missing: string[];
}

interface CacheEntry {
  mtime: number;
  result: GlossaryParseResult;
}

export class GlossaryRegistry {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly app: App) {}

  /** Every note declaring itself a glossary, sorted by path. */
  listCandidates(): GlossaryCandidate[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const marker = frontmatter?.[GLOSSARY_MARKER];
        return marker === true || marker === "true" || marker === "yes";
      })
      .map((file) => ({ path: file.path, name: file.basename }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Load and parse the selected glossaries, in the order given. */
  async load(paths: string[], sourcePath = ""): Promise<LoadedGlossaries> {
    const glossaries: Glossary[] = [];
    const errors: string[] = [];
    const missing: string[] = [];

    for (const path of paths) {
      const file = this.resolve(path, sourcePath);
      if (!file) {
        missing.push(path);
        continue;
      }

      const result = await this.parseFile(file);
      glossaries.push(result.glossary);
      errors.push(...result.errors.map((error) => `${file.basename}: ${error}`));
    }

    return { glossaries, errors, missing };
  }

  /** Drop a file's cached parse. Called when the vault reports a change. */
  invalidate(path: string): void {
    this.cache.delete(path);
  }

  clear(): void {
    this.cache.clear();
  }

  /** Accepts a vault path or a link-style name, so a glossary can be named the
   *  way it is linked elsewhere in the vault. */
  private resolve(path: string, sourcePath: string): TFile | null {
    const direct = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (direct) return direct;

    const withExtension = path.endsWith(".md") ? path : `${path}.md`;
    return this.app.metadataCache.getFirstLinkpathDest(withExtension, sourcePath);
  }

  private async parseFile(file: TFile): Promise<GlossaryParseResult> {
    const cached = this.cache.get(file.path);
    if (cached && cached.mtime === file.stat.mtime) {
      return cached.result;
    }

    const text = await this.app.vault.cachedRead(file);
    const result = parseGlossary(file.path, text);
    this.cache.set(file.path, { mtime: file.stat.mtime, result });
    return result;
  }
}
