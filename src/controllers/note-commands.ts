import { type App, MarkdownView, Notice } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import { newNotePath } from "../services/new-note";

/**
 * A blank note, and nothing else on screen.
 *
 * Starting to write took three moves: make the note, open it, close the two
 * sidebars that crowd a writing session. This is the one command that does
 * all of them. The note is named and placed the way Obsidian's own new-note
 * command does it, so nothing about the vault changes; only the screen does.
 *
 * It opens a tab in the main window rather than a pop-out: a pop-out has no
 * sidebars to hide, does not exist on a phone, and is a different way of
 * working than "this note, full width, now".
 */
export class NoteCommands {
  constructor(
    private readonly app: App,
    private readonly logger: Logger
  ) {}

  async createUntitled(): Promise<void> {
    const base = t().notes.untitled;
    const source = this.app.workspace.getActiveFile()?.path ?? "";
    // The second argument lets Obsidian apply the preference for Markdown
    // files, which is the one that says where new notes go.
    const folder = this.app.fileManager.getNewFileParent(source, `${base}.md`);
    const path = newNotePath(
      folder.path,
      base,
      (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null
    );

    let file;
    try {
      file = await this.app.vault.create(path, "");
    } catch (error) {
      // A sync client that dropped the same name a moment ago, or a file
      // that differs only in case on a filesystem that does not: either way
      // the vault said no, and saying so beats guessing another name.
      this.logger.warn(`Could not create ${path}:`, error);
      new Notice(t().common.notice(t().notes.createFailed));
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);

    // After the open, so nothing about opening can reveal a sidebar again.
    this.app.workspace.leftSplit.collapse();
    this.app.workspace.rightSplit.collapse();

    // Last, so nothing after it takes the focus back.
    if (leaf.view instanceof MarkdownView) leaf.view.editor.focus();
  }
}
