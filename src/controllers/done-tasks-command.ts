import { type App, type Editor, MarkdownView, Notice, type TFile } from "obsidian";
import { t } from "../i18n";
import { clearDoneTasks, type DoneTaskMode } from "../services/done-tasks";
import type { Logger } from "../services/logger";
import { applyEdit, revertEdit, smallestEdit, type TextEdit } from "../services/text-revert";
import { UNDO_WINDOW_MS } from "../services/undo-stack";
import { showActionNotice } from "../ui/action-notice";

/** Shows `message`, and `label` beside it; pressing that runs `onUndo`. */
export type UndoToaster = (message: string, label: string, onUndo: () => void) => void;

type TextEditor = Pick<Editor, "getValue" | "offsetToPos" | "replaceRange">;

/**
 * The command that tidies up a note's done tasks, the way the settings say.
 *
 * The change is one replacement in the editor, so the editor's own undo takes
 * it back in one step. The notice offers the same for half a minute, which is
 * the undo a person on a phone can reach; it keeps whatever was typed
 * elsewhere in the note since, and finds the note again if it is open in
 * another tab or no longer open at all.
 */
export class DoneTasksCommand {
  constructor(
    private readonly app: App,
    private readonly mode: () => DoneTaskMode,
    private readonly logger: Logger,
    private readonly toast: UndoToaster = (message, label, onUndo) =>
      showActionNotice(message, label, onUndo, UNDO_WINDOW_MS)
  ) {}

  run(editor: TextEditor, file: TFile | null): void {
    const mode = this.mode();
    const before = editor.getValue();
    const { content: after, count } = clearDoneTasks(before, mode);
    const words = t().tasks;
    if (count === 0) {
      new Notice(t().common.notice(mode === "back" ? words.nothingBack : words.nothing));
      return;
    }

    replace(editor, smallestEdit(before, after));
    const message =
      mode === "back"
        ? words.moved(count)
        : mode === "archive"
          ? words.archived(count)
          : words.deleted(count);
    this.toast(t().common.notice(message), words.undo, () => {
      void this.undo(file, editor, before, after);
    });
  }

  private async undo(
    file: TFile | null,
    editor: TextEditor,
    before: string,
    after: string
  ): Promise<void> {
    const open = file ? this.editorShowing(file) : editor;
    let undone = false;
    if (open) {
      const edit = revertEdit(open.getValue(), before, after);
      if (edit) replace(open, edit);
      undone = edit !== null;
    } else if (file) {
      try {
        await this.app.vault.process(file, (text) => {
          const edit = revertEdit(text, before, after);
          undone = edit !== null;
          return edit ? applyEdit(text, edit) : text;
        });
      } catch (error) {
        this.logger.warn(`Could not undo the tidy-up in ${file.path}:`, error);
      }
    }
    new Notice(t().common.notice(undone ? t().tasks.undone : t().tasks.undoFailed));
  }

  /**
   * The editor the note is open in now. The one the command ran in may have
   * moved on to another note, and an edit made through the vault would race
   * whatever an open editor has not yet saved.
   */
  private editorShowing(file: TFile): TextEditor | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) return view.editor;
    }
    return null;
  }
}

function replace(editor: TextEditor, edit: TextEdit): void {
  editor.replaceRange(edit.text, editor.offsetToPos(edit.from), editor.offsetToPos(edit.to));
}
