import { type App, type Editor, MarkdownView, type Menu, Notice, type TFile } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import {
  buildReminder,
  findTaskLine,
  generateTaskId,
  isTaskLine,
  reminderIdOf,
  shortcutUrl,
  taskIdFromParams,
  taskIdInUse,
  withReminderLink
} from "../services/reminder-export";
import type { SchreibstubeSettings } from "../types";

/** How many times to draw an id before settling for a collision, which at
 *  36^6 possibilities is a formality. */
const ID_ATTEMPTS = 20;

interface TaskLocation {
  file: TFile;
  line: number;
}

/**
 * Sending a task to Apple's Reminders, and coming back from one.
 *
 * The decisions — what the title is, what the note is, what the link looks
 * like — are in services/reminder-export. This is the wiring: read the task
 * under the cursor, put the link on it, open the Shortcut, and when a
 * reminder's link is followed, find the note that carries the same link and
 * open it on that line.
 */
export class ReminderCommands {
  /** Where an id was last found, so the second visit reads one note, not all. */
  private readonly located = new Map<string, string>();

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

    // The link goes into the note before the reminder exists, so the link the
    // reminder carries points at something from the first moment.
    let id = reminderIdOf(text);
    if (!id) {
      id = this.freshId(editor.getValue());
      editor.setLine(line, withReminderLink(text, id));
    }
    this.located.set(id, file.path);

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

  /** `obsidian://schreibstube?task=<id>`: open the note on the task's line. */
  async openTask(params: Record<string, string>): Promise<void> {
    const id = taskIdFromParams(params);
    if (!id) return;

    const found = await this.locate(id);
    if (!found) {
      new Notice(t().common.notice(t().tasks.taskNotFound));
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(found.file, {
      eState: { line: found.line }
    });
  }

  /**
   * The note that carries the link for `id`, and the line. The last known
   * note is tried first; failing that, every note, since the link does not
   * say where it lives and a note can have moved since it was sent.
   */
  private async locate(id: string): Promise<TaskLocation | null> {
    const remembered = this.located.get(id);
    if (remembered) {
      const file = this.app.vault.getAbstractFileByPath(remembered);
      if (file && "extension" in file) {
        const hit = await this.lineIn(file as TFile, id);
        if (hit) return hit;
      }
      this.located.delete(id);
    }

    for (const file of this.app.vault.getMarkdownFiles()) {
      const hit = await this.lineIn(file, id);
      if (hit) {
        this.located.set(id, file.path);
        return hit;
      }
    }
    return null;
  }

  private async lineIn(file: TFile, id: string): Promise<TaskLocation | null> {
    const line = findTaskLine(await this.app.vault.cachedRead(file), id);
    return line === null ? null : { file, line };
  }

  private freshId(content: string): string {
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt += 1) {
      const id = generateTaskId();
      if (!taskIdInUse(content, id)) return id;
    }
    return generateTaskId();
  }
}
