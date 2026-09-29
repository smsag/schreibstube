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
import { t } from "../i18n";
import {
  GLOSSARY_MARKER,
  parseGlossary,
  type Glossary,
  type GlossaryParseResult
} from "../services/glossary-parser";
import {
  buildTermFolderGlossaries,
  definitionExcerpt,
  isInTermFolder,
  readTermRule,
  type TermRule
} from "../services/glossary-term-folder";

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

/** A term note in the folder, for the picker that adds a rule to one. */
export interface TermNoteEntry {
  path: string;
  term: string;
}

export class GlossaryRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  /** The folder's glossaries, rebuilt after any change inside the folder. */
  private folderCache: { folder: string; glossaries: Glossary[] } | null = null;

  constructor(
    private readonly app: App,
    private readonly getTermFolder: () => string = () => ""
  ) {}

  /** Every note declaring itself a glossary, and the term folder when one is
   *  set and holds notes, sorted by path. */
  listCandidates(): GlossaryCandidate[] {
    const candidates = this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const marker = frontmatter?.[GLOSSARY_MARKER];
        return marker === true || marker === "true" || marker === "yes";
      })
      .map((file) => ({ path: file.path, name: file.basename }));
    const folder = this.getTermFolder();
    if (this.termFiles().length > 0) {
      candidates.push({ path: folder, name: folder.split("/").pop() ?? folder });
    }
    return candidates.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** The term notes in the folder, sorted by term. Frontmatter only, from the
   *  metadata cache, so listing them reads no file. */
  termNotes(): TermNoteEntry[] {
    return this.termFiles()
      .map((file) => {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const rule = readTermRule({ path: file.path, basename: file.basename, frontmatter });
        return rule ? { path: file.path, term: rule.term } : null;
      })
      .filter((entry): entry is TermNoteEntry => entry !== null)
      .sort((a, b) => a.term.localeCompare(b.term));
  }

  /** The term notes that list at least one word to avoid, sorted by term. */
  termRules(): TermRule[] {
    return this.readRules()
      .filter((rule) => rule.avoid.length > 0)
      .sort((a, b) => a.term.localeCompare(b.term));
  }

  /** Load and parse the selected glossaries, in the order given. */
  async load(paths: string[], sourcePath = ""): Promise<LoadedGlossaries> {
    const glossaries: Glossary[] = [];
    const errors: string[] = [];
    const missing: string[] = [];

    for (const path of paths) {
      const folder = this.getTermFolder();
      if (folder && path === folder) {
        glossaries.push(...(await this.loadTermFolder(folder)));
        continue;
      }
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
    if (isInTermFolder(path, this.getTermFolder())) this.folderCache = null;
  }

  clear(): void {
    this.cache.clear();
    this.folderCache = null;
  }

  private termFiles(): TFile[] {
    const folder = this.getTermFolder();
    if (!folder) return [];
    return this.app.vault.getMarkdownFiles().filter((file) => isInTermFolder(file.path, folder));
  }

  private readRules(): TermRule[] {
    return this.termFiles()
      .map((file) =>
        readTermRule({
          path: file.path,
          basename: file.basename,
          frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter
        })
      )
      .filter((rule): rule is TermRule => rule !== null);
  }

  /**
   * Only the notes with a rule are read, for their definition: the rest check
   * nothing, and a folder of a thousand terms must not cost a thousand reads
   * every time one of them is edited.
   */
  private async loadTermFolder(folder: string): Promise<Glossary[]> {
    if (this.folderCache?.folder === folder) return this.folderCache.glossaries;
    const files = new Map(this.termFiles().map((file) => [file.path, file]));
    const withNotes = await Promise.all(
      this.termRules().map(async (rule) => {
        const file = files.get(rule.path);
        const definition = file ? definitionExcerpt(await this.app.vault.cachedRead(file)) : "";
        const note =
          definition && rule.byModel ? t().proofread.termByModel(definition) : definition;
        return { ...rule, note };
      })
    );
    const glossaries = buildTermFolderGlossaries(folder, withNotes);
    this.folderCache = { folder, glossaries };
    return glossaries;
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
