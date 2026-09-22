import { type App, type Editor, MarkdownView, type Menu, Notice, TFile } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import {
  blockIdOf,
  blockIdsIn,
  findTaskLine,
  isReminderTask,
  isTaskLine,
  reminderTasksIn,
  taskIdFromParams,
  taskTitle,
  withDone,
  withRemindTag,
  withTaskIds,
  type NoteTask
} from "../services/reminder-tasks";
import {
  buildOutbox,
  parseInbox,
  parseState,
  reconcile,
  uniqueTasks,
  type NoteChange
} from "../services/reminder-sync";
import type { SchreibstubeSettings } from "../types";

/** Long enough that typing a task is one sync, not one per keystroke. */
const SYNC_DELAY_MS = 3000;

/** Cheap signs that a note may hold a reminder task, before its lines are read. */
const CANDIDATE_SIGNS = ["📅", "#remind", "^", "schreibstube?task="];

export const OUTBOX_FILE = "outbox.json";
export const INBOX_FILE = "inbox.json";
export const STATE_FILE = "state.json";

interface TaskLocation {
  file: TFile;
  line: number;
}

/**
 * Keeps the Reminders list in agreement with the vault.
 *
 * Every decision is in services/reminder-sync and services/reminder-tasks.
 * This reads the notes, hands them over with the two files the Shortcut
 * shares, and writes back what came out: ids onto new reminder tasks, ticks
 * onto tasks done in Reminders, the outbox for the Shortcut, the state for
 * next time. A pass runs a little after a note changes and whenever the
 * Shortcut has written a new inbox; passes never overlap.
 */
export class ReminderSync {
  /** Where an id was last found, so following a reminder's link reads one note, not all. */
  private readonly located = new Map<string, string>();
  private running = false;
  private again = false;
  private timer: number | null = null;
  private inboxSeenAt = 0;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger
  ) {}

  private get folder(): string {
    return this.getSettings().remindersFolder;
  }

  private path(file: string): string {
    return `${this.folder}/${file}`;
  }

  /** A pass a little later, after the typing has stopped. */
  scheduleSync(): void {
    if (!this.getSettings().remindersEnabled) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, SYNC_DELAY_MS);
  }

  cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  /** A pass when the Shortcut has written a new inbox. One stat when it has not. */
  async pollInbox(): Promise<void> {
    if (!this.getSettings().remindersEnabled) return;
    try {
      const stat = await this.app.vault.adapter.stat(this.path(INBOX_FILE));
      const mtime = stat?.mtime ?? 0;
      if (mtime <= this.inboxSeenAt) return;
      this.inboxSeenAt = mtime;
    } catch {
      return;
    }
    await this.sync();
  }

  /** A pass now, reporting what it did. The command's way in. */
  async syncNow(): Promise<void> {
    if (!this.featureOn()) return;
    const changes = await this.sync();
    new Notice(
      t().common.notice(changes === null ? t().tasks.syncFailed : t().tasks.synced(changes))
    );
  }

  /**
   * One pass. Returns how many tasks it ticked or reopened, or null when it
   * failed; a pass asked for while one runs is folded into a second one.
   */
  async sync(): Promise<number | null> {
    if (!this.getSettings().remindersEnabled) return 0;
    if (this.running) {
      this.again = true;
      return 0;
    }
    this.running = true;
    let total = 0;
    try {
      do {
        this.again = false;
        total += await this.pass();
      } while (this.again);
      return total;
    } catch (error) {
      this.logger.warn("Reminders sync failed:", error);
      return null;
    } finally {
      this.running = false;
    }
  }

  private async pass(): Promise<number> {
    const settings = this.getSettings();
    const trigger = settings.remindersTrigger;
    const tasks = await this.collectTasks(trigger);

    const { tasks: unique, duplicates } = uniqueTasks(tasks);
    for (const task of duplicates) {
      this.logger.warn(`Block id ^${task.id} in ${task.path} is used elsewhere; not synced.`);
    }

    const adapter = this.app.vault.adapter;
    const stateText = await this.readIfThere(this.path(STATE_FILE));
    const inboxText = await this.readIfThere(this.path(INBOX_FILE));
    const inbox = inboxText === null ? null : parseInbox(inboxText);
    if (inboxText !== null && inbox === null) {
      this.logger.warn(`${this.path(INBOX_FILE)} is not an inbox the sync can read.`);
    }

    const result = reconcile({ tasks: unique, inbox, state: parseState(stateText) });
    const changed = await this.applyChanges(result.changes);
    if (result.detached.length > 0) {
      this.logger.debug(`Deleted in Reminders, detached: ${result.detached.join(", ")}.`);
    }

    if (!(await adapter.exists(this.folder))) await adapter.mkdir(this.folder);
    await this.writeIfChanged(this.path(STATE_FILE), JSON.stringify(result.state, null, 1));
    const outbox = buildOutbox(result.state, settings.remindersList);
    await this.writeIfChanged(this.path(OUTBOX_FILE), JSON.stringify(outbox, null, 1));

    this.logger.debug(
      `Reminders sync: ${unique.length} task(s), ${outbox.ops.length} pending, ${changed} changed.`
    );
    if (changed > 0) new Notice(t().common.notice(t().tasks.fromReminders(changed)));
    return changed;
  }

  /**
   * Every reminder task in the vault, after giving the new ones an id.
   *
   * Only notes that could hold one are read, and a note is written only when
   * an id went onto one of its lines.
   */
  private async collectTasks(
    trigger: SchreibstubeSettings["remindersTrigger"]
  ): Promise<NoteTask[]> {
    const contents = new Map<TFile, string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.mayHoldTasks(file)) continue;
      const content = await this.app.vault.cachedRead(file);
      if (CANDIDATE_SIGNS.some((sign) => content.includes(sign))) contents.set(file, content);
    }

    const taken = new Set<string>();
    for (const content of contents.values()) for (const id of blockIdsIn(content)) taken.add(id);

    const tasks: NoteTask[] = [];
    for (const [file, content] of contents) {
      let current = content;
      if (withTaskIds(content, trigger, new Set(taken)) !== null) {
        await this.app.vault.process(file, (latest) => {
          current = withTaskIds(latest, trigger, taken) ?? latest;
          return current;
        });
      }
      for (const task of reminderTasksIn(file.path, file.basename, current, trigger)) {
        tasks.push(task);
        this.located.set(task.id, file.path);
      }
    }
    return tasks;
  }

  /** A note Obsidian has indexed without a single task cannot hold a reminder. */
  private mayHoldTasks(file: TFile): boolean {
    const cache = this.app.metadataCache?.getFileCache(file);
    if (!cache) return true;
    return cache.listItems?.some((item) => item.task !== undefined) ?? false;
  }

  /** Ticks or reopens tasks Reminders changed, one write per note. */
  private async applyChanges(changes: readonly NoteChange[]): Promise<number> {
    const byPath = new Map<string, NoteChange[]>();
    for (const change of changes) {
      byPath.set(change.path, [...(byPath.get(change.path) ?? []), change]);
    }

    let applied = 0;
    for (const [path, list] of byPath) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const wanted = new Map(list.map((change) => [change.id, change.done]));
      await this.app.vault.process(file, (content) => {
        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        return content
          .split(/\r?\n/)
          .map((line) => {
            const id = blockIdOf(line);
            const done = id === null ? undefined : wanted.get(id);
            if (done === undefined) return line;
            const updated = withDone(line, done);
            if (updated !== line) applied += 1;
            return updated;
          })
          .join(newline);
      });
    }
    return applied;
  }

  private async readIfThere(path: string): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    return (await adapter.exists(path)) ? adapter.read(path) : null;
  }

  /** The files are synced to every device; writing an unchanged one would only make conflicts. */
  private async writeIfChanged(path: string, text: string): Promise<void> {
    if ((await this.readIfThere(path)) === text) return;
    await this.app.vault.adapter.write(path, text);
  }

  // -------------------------------------------------------------------------
  // The command and the menu: make the task under the cursor a reminder.

  sendTaskAtCursor(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    this.sendTask(view.editor, view.editor.getCursor().line);
  }

  /**
   * Tags the task so the sync picks it up. The tag is the whole act: the
   * reminder follows from it, and deleting the tag takes the reminder away.
   */
  sendTask(editor: Editor, line: number): void {
    if (!this.featureOn()) return;
    const text = editor.getLine(line);
    if (!isTaskLine(text)) {
      new Notice(t().common.notice(t().tasks.notATask));
      return;
    }
    if (!isReminderTask(text, this.getSettings().remindersTrigger)) {
      editor.setLine(line, withRemindTag(text));
    }
    new Notice(t().common.notice(t().tasks.queued(taskTitle(text))));
    this.scheduleSync();
  }

  addMenuItem(menu: Menu, editor: Editor): void {
    menu.addItem((item) => {
      item
        .setTitle(t().tasks.menuSend)
        .setIcon("bell")
        .onClick(() => {
          this.sendTask(editor, editor.getCursor().line);
        });
    });
  }

  // -------------------------------------------------------------------------
  // The way back: a reminder's link opens the note on the task's line.

  /** `obsidian://schreibstube?task=<id>`. Anything else is ignored. */
  async handleProtocol(params: Record<string, string>): Promise<void> {
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

  private async locate(id: string): Promise<TaskLocation | null> {
    const remembered = this.located.get(id);
    if (remembered) {
      const file = this.app.vault.getAbstractFileByPath(remembered);
      if (file instanceof TFile) {
        const hit = await this.lineIn(file, id);
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

  private featureOn(): boolean {
    if (this.getSettings().remindersEnabled) return true;
    new Notice(t().common.notice(t().tasks.remindersOff));
    return false;
  }
}
