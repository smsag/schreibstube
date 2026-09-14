import { type App, type Editor, MarkdownView, type Menu, Notice, type TFile } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import {
  blockIdOf,
  buildReminder,
  generateBlockId,
  isTaskLine,
  shortcutUrl,
  taskIdFromParams,
  withBlockId
} from "../services/reminder-export";
import type { SchreibstubeSettings } from "../types";

/** How many times to draw a block id before settling for a collision, which
 *  at 36^6 possibilities is a formality. */
const BLOCK_ID_ATTEMPTS = 20;

/**
 * Sending a task to Apple's Reminders, and coming back from one.
 *
 * The decisions — what the title is, what the note is, what the link looks
 * like — are in services/reminder-export. This is the wiring: read the task
 * under the cursor, put a block id on it, open the Shortcut, and when a
 * reminder's link is followed, find the note the block id lives in and open
 * it there.
 */
export class ReminderCommands {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger,
    private readonly openUrl: (url: string) => void = (url) => {
      window.open(url);
    }
  ) {}

  /** The task under the cursor of the active editor. */
  sendTaskAtCursor(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    this.sendTask(view.editor, view.editor.getCursor().line, view.file);
  }

  sendTask(editor: Editor, line: number, file: TFile): void {
    const settings = this.getSettings();
    if (!settings.remindersEnabled) {
      new Notice(t().common.notice(t().tasks.remindersOff));
      return;
    }
    if (settings.remindersShortcut.trim() === "") {
      new Notice(t().common.notice(t().tasks.noShortcut));
      return;
    }

    const text = editor.getLine(line);
    if (!isTaskLine(text)) {
      new Notice(t().common.notice(t().tasks.notATask));
      return;
    }

    // The id goes into the note before the reminder exists, so the link the
    // reminder carries points at something from the first moment.
    let id = blockIdOf(text);
    if (!id) {
      id = this.freshBlockId(file);
      editor.setLine(line, withBlockId(text, id));
    }

    const payload = buildReminder({
      lines: editor.getValue().split(/\r?\n/),
      taskLine: line,
      id,
      list: settings.remindersList,
      noteTitle: file.basename
    });

    this.logger.debug(`Sending task ${id} in ${file.path} to Reminders.`);
    this.openUrl(shortcutUrl(settings.remindersShortcut, payload));
    new Notice(t().common.notice(t().tasks.sent(payload.title)));
  }

  /** The entry in the editor's context menu, for the task under the cursor. */
  addMenuItem(menu: Menu, editor: Editor, file: TFile): void {
    menu.addItem((item) => {
      item
        .setTitle(t().tasks.menuSend)
        .setIcon("bell")
        .onClick(() => {
          this.sendTask(editor, editor.getCursor().line, file);
        });
    });
  }

  /** `obsidian://schreibstube?task=<id>`: open the note that holds the block. */
  async openTask(params: Record<string, string>): Promise<void> {
    const id = taskIdFromParams(params);
    if (!id) return;

    const file = this.fileWithBlock(id);
    if (!file) {
      new Notice(t().common.notice(t().tasks.taskNotFound));
      return;
    }

    await this.app.workspace.openLinkText(`${file.path}#^${id}`, "", false);
  }

  /** The note whose block index has `id`, wherever it is in the vault. */
  private fileWithBlock(id: string): TFile | null {
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.app.metadataCache.getFileCache(file)?.blocks?.[id]) return file;
    }
    return null;
  }

  private freshBlockId(file: TFile): string {
    const taken = new Set(Object.keys(this.app.metadataCache.getFileCache(file)?.blocks ?? {}));
    for (let attempt = 0; attempt < BLOCK_ID_ATTEMPTS; attempt += 1) {
      const id = generateBlockId();
      if (!taken.has(id)) return id;
    }
    return generateBlockId();
  }
}
