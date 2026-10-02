/**
 * What the "Callouts & highlights" layout asks of the vault: a note's
 * passages, read once per version of the note, and a note opened at a line.
 *
 * A base draws again whenever a listed note changes, and most of its notes
 * have not; their passages are kept by path and modification time, so a
 * redraw reads only what was written. What a passage is, is
 * `services/passages`.
 */
import { MarkdownRenderer, type App, type Component, type TFile } from "obsidian";
import type { Logger } from "../services/logger";
import type { PaneTarget } from "../services/pane-target";
import { findPassages, MAX_PASSAGE_NOTE_BYTES, type NotePassages } from "../services/passages";
import { openInPane } from "../platform/open-in-pane";
import type { PassagesHost } from "../ui/passages-view";

interface Known {
  mtime: number;
  size: number;
  passages: NotePassages;
}

export class PassagesController implements PassagesHost {
  private readonly known = new Map<string, Known>();

  constructor(
    private readonly app: App,
    private readonly logger: Logger
  ) {}

  async passages(file: TFile): Promise<NotePassages | null> {
    if (file.stat.size > MAX_PASSAGE_NOTE_BYTES) return null;
    const known = this.known.get(file.path);
    if (known && known.mtime === file.stat.mtime && known.size === file.stat.size) {
      return known.passages;
    }
    try {
      const passages = findPassages(await this.app.vault.cachedRead(file));
      this.known.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, passages });
      return passages;
    } catch (error) {
      this.logger.debug(`passages: could not read ${file.path}`, error);
      return null;
    }
  }

  forget(path: string): void {
    this.known.delete(path);
  }

  async open(file: TFile, line: number, where: PaneTarget, reading: boolean): Promise<void> {
    await openInPane(this.app, file, where, {
      ...(reading ? { state: { mode: "preview" } } : {}),
      eState: { line }
    });
  }

  render(markdown: string, el: HTMLElement, sourcePath: string, owner: Component): Promise<void> {
    return MarkdownRenderer.render(this.app, markdown, el, sourcePath, owner);
  }
}
