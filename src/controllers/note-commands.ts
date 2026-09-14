import { type App, MarkdownView, Notice, Platform, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import { newNotePath } from "../services/new-note";

/**
 * A blank note in a window of its own, in front of everything.
 *
 * Starting to write took three moves: make the note, open it, get the rest
 * of the workspace out of the way. This is the one command that does all of
 * them. The note is named and placed the way Obsidian's own new-note command
 * does it, so nothing about the vault changes; only what is on screen does.
 *
 * The note opens in a new window, whatever windows and tabs are already
 * there, and that window takes the focus. A pop-out has no sidebars, so the
 * screen holds the note and nothing else. A phone has no windows at all;
 * there the note opens in a new tab and both drawers close, which is the
 * nearest thing to the same experience.
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

    const leaf = Platform.isDesktopApp
      ? this.app.workspace.openPopoutLeaf()
      : this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);

    if (!Platform.isDesktopApp) {
      // After the open, so nothing about opening can reveal a drawer again.
      this.app.workspace.leftSplit.collapse();
      this.app.workspace.rightSplit.collapse();
    }

    // The window first, then the leaf in it, then the editor: each is
    // needed for the next to mean anything, and the last one is what puts
    // the cursor where the typing goes.
    bringWindowToFront(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (leaf.view instanceof MarkdownView) leaf.view.editor.focus();
  }
}

/**
 * A pop-out leaf lives in a `WorkspaceWindow`, whose `win` is the browser
 * window itself. The main window's container has no `win`, and a phone has
 * neither; both are left alone.
 */
function bringWindowToFront(leaf: WorkspaceLeaf): void {
  const container = leaf.getContainer() as { win?: { focus?: () => void } };
  if (typeof container.win?.focus === "function") container.win.focus();
}
