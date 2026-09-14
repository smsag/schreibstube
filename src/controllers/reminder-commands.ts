import { type App, type Editor, MarkdownView, type Menu, Notice, TFile } from "obsidian";
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
import {
  applyDone,
  idsInReport,
  isStatusCallback,
  reportFromParams,
  sentTaskIds,
  statusShortcutUrl
} from "../services/reminder-status";
import type { SchreibstubeSettings } from "../types";

/** How many times to draw an id before settling for a collision, which at
 *  36^6 possibilities is a formality. */
const ID_ATTEMPTS = 20;

interface TaskLocation {
  file: TFile;
  line: number;
}

/**
 * Sending a task to Apple's Reminders, and what comes back.
 *
 * The decisions — what the title is, what the note is, what the link looks
 * like, which tasks a report ticks — are in services/reminder-export and
 * services/reminder-status. This is the wiring: read the task under the
 * cursor, put the link on it, open a Shortcut; answer a reminder's link by
 * opening the note on the right line; and take a report of done reminders,
 * from a callback or from a file an automation wrote, and tick the tasks.
 */
export class ReminderCommands {
  /** Where an id was last found, so the second visit reads one note, not all. */
  private readonly located = new Map<string, string>();
  /** The report file's modification time as last applied. */
  private reportSeenAt = 0;
  private reportBusy = false;

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
    if (!this.featureOn(settings)) return;
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

  /** Ask Reminders about every sent task in the active note. */
  checkActiveNote(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    this.checkNote(view.editor.getValue());
  }

  checkNote(content: string): void {
    const ids = sentTaskIds(content);
    if (ids.length === 0) {
      new Notice(t().common.notice(t().tasks.noneSent));
      return;
    }
    this.requestStatus(ids);
  }

  /** Ask Reminders about every completed reminder in the list, note by note. */
  checkEverything(): void {
    this.requestStatus([]);
  }

  private requestStatus(ids: string[]): void {
    const settings = this.getSettings();
    if (!this.featureOn(settings)) return;
    if (settings.remindersStatusShortcut.trim() === "") {
      new Notice(t().common.notice(t().tasks.noStatusShortcut));
      return;
    }

    this.logger.debug(`Asking Reminders about ${ids.length || "all"} task(s).`);
    this.openUrl(
      statusShortcutUrl(settings.remindersStatusShortcut, { ids, list: settings.remindersList })
    );
    new Notice(t().common.notice(t().tasks.checking));
  }

  /** Every `obsidian://schreibstube` call: a report of done reminders, or a link to a task. */
  async handleProtocol(params: Record<string, string>): Promise<void> {
    if (isStatusCallback(params)) {
      const ticked = await this.applyReport(reportFromParams(params));
      new Notice(t().common.notice(ticked > 0 ? t().tasks.ticked(ticked) : t().tasks.nothingDone));
      return;
    }
    await this.openTask(params);
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
   * Ticks every open task a report names, in whichever note it lives.
   * Returns how many tasks changed. Every note is read once; a note is
   * written only when something in it changes, through the vault's own
   * read-modify-write so an editor with the note open sees the tick.
   */
  async applyReport(text: string): Promise<number> {
    const ids = idsInReport(text);
    if (ids.length === 0) return 0;

    let ticked = 0;
    // Notes this session already sent a task from come first, and the vault
    // only for the ids they did not account for. A report naming one task
    // used to read every note in the vault to find it.
    const remaining = new Set(ids);
    for (const file of this.filesForReport(ids)) {
      if (remaining.size === 0) break;

      const wanted = [...remaining];
      const before = await this.app.vault.cachedRead(file);
      if (applyDone(before, wanted).ticked.length === 0) continue;

      await this.app.vault.process(file, (current) => {
        const result = applyDone(current, wanted);
        ticked += result.ticked.length;
        for (const id of result.ticked) {
          this.located.set(id, file.path);
          remaining.delete(id);
        }
        return result.content;
      });
    }

    this.logger.debug(`Reminders report named ${ids.length} task(s); ${ticked} ticked.`);
    return ticked;
  }

  /**
   * The report file an automation writes into the vault. Read when it has
   * changed since the last look, and applied like a callback. Called on the
   * plugin's poll tick, so the cost of a quiet file is one stat.
   */
  async pollReportFile(): Promise<void> {
    const settings = this.getSettings();
    if (!settings.remindersEnabled || this.reportBusy) return;
    const path = settings.remindersReportFile.trim();
    if (path === "") return;

    const adapter = this.app.vault.adapter;
    this.reportBusy = true;
    try {
      if (!(await adapter.exists(path))) return;
      const mtime = (await adapter.stat(path))?.mtime ?? 0;
      if (mtime <= this.reportSeenAt) return;
      this.reportSeenAt = mtime;

      const ticked = await this.applyReport(await adapter.read(path));
      if (ticked > 0) new Notice(t().common.notice(t().tasks.ticked(ticked)));
    } catch (error) {
      this.logger.warn(`Could not read the Reminders report at ${path}:`, error);
    } finally {
      this.reportBusy = false;
    }
  }

  private featureOn(settings: SchreibstubeSettings): boolean {
    if (settings.remindersEnabled) return true;
    new Notice(t().common.notice(t().tasks.remindersOff));
    return false;
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

  /**
   * The notes worth reading for a report, nearest first.
   *
   * Every task this session sent was remembered along with the note it was
   * in, and nothing ever asked. The vault still follows, because a report can
   * name a task sent from another device, or before a restart.
   */
  private filesForReport(ids: readonly string[]): TFile[] {
    const known: TFile[] = [];
    const seen = new Set<string>();

    for (const id of ids) {
      const path = this.located.get(id);
      if (path === undefined || seen.has(path)) continue;
      seen.add(path);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) known.push(file);
    }

    return [...known, ...this.app.vault.getMarkdownFiles().filter((f) => !seen.has(f.path))];
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
