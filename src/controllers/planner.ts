import { type App, Notice, TFile } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import { resolveApiKey } from "../services/secret";
import { normalizeBaseUrl } from "../services/bridge-protocol";
import {
  deleteEvent,
  fetchEvents,
  fetchHealth,
  fetchPlan,
  savePlan,
  saveEvent
} from "../services/plan-client";
import {
  PlanConflict,
  PLAN_PROTOCOL_VERSION,
  type CalendarEvent,
  type PlanBridgeConfig
} from "../services/plan-protocol";
import {
  blockOfKey,
  dayKey,
  emptyPlan,
  generateKey,
  type PlanBlock,
  type PlanDocument,
  type PlanMember
} from "../services/plan-model";
import {
  applyMatch,
  buildQueue,
  keysForTasks,
  pruneAnchors,
  removeBlock,
  setDeadline,
  setMembers,
  takeCompletions,
  upsertBlock,
  type ReminderFields
} from "../services/plan-edit";
import { matchAnchors, renamedAnchors } from "../services/task-identity";
import { tasksInNote, type VaultTask } from "../services/task-inventory";
import type { SchreibstubeSettings } from "../types";

/** How long a scan of the vault's tasks is reused before it is taken again. */
const SCAN_TTL_MS = 5000;

/** Signs a note may hold a task at all, before its lines are read. */
const TASK_SIGN = "- [";

export interface PlannerState {
  plan: PlanDocument;
  tasks: VaultTask[];
  /** Keys the plan refers to whose task could not be found in the vault. */
  lost: string[];
  /** Null until the bridge has answered once. */
  loadedAt: number | null;
  error: string | null;
}

/**
 * The day planner: the vault's tasks, the plan on the bridge, and the blocks
 * in the calendar, kept in agreement.
 *
 * Every decision is in services — what a task is, which key it kept, what to
 * propose, what the reminder queue should hold. This reads notes, calls the
 * bridge and hands the result to whoever is drawing it: the leaf, the block
 * on a start page, and in time a widget reading the same document.
 *
 * Notes are written in exactly one case: a task Reminders reported as done.
 */
export class Planner {
  private state: PlannerState = {
    plan: emptyPlan(),
    tasks: [],
    lost: [],
    loadedAt: null,
    error: null
  };
  private rev = 0;
  private scannedAt = 0;
  private refreshing: Promise<void> | null = null;
  private handshakeDone = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger
  ) {}

  current(): PlannerState {
    return this.state;
  }

  /** Redraw whoever is showing the plan; the leaf and every open block. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  configured(): boolean {
    const settings = this.getSettings();
    return settings.plannerEnabled && settings.plannerBridgeUrl.trim() !== "";
  }

  /**
   * Reads the vault and the bridge, reconciles them and publishes the result.
   *
   * Passes never overlap: a second caller waits for the one in flight rather
   * than starting a competing read-modify-write against the same document.
   */
  async refresh(force = false): Promise<void> {
    if (!this.configured()) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.runRefresh(force).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async runRefresh(force: boolean): Promise<void> {
    const bridge = this.bridge();
    if (!bridge) return;

    try {
      await this.checkBridgeVersion(bridge);
      const stored = await fetchPlan(bridge);
      this.rev = stored.rev;
      const tasks = await this.scan(force);
      const match = matchAnchors(stored.plan.anchors, tasks);

      let plan = applyMatch(stored.plan, match);
      const completions = takeCompletions(plan, match.bound);
      plan = completions.plan;
      await this.applyEdits(completions.edits);

      plan = pruneAnchors(this.withQueue(plan, match.bound));
      this.publish({ plan, tasks, lost: match.lost, loadedAt: Date.now(), error: null });

      if (JSON.stringify(plan) !== JSON.stringify(stored.plan)) await this.push(plan);
      if (completions.edits.length > 0) {
        new Notice(t().common.notice(t().planner.ticked(completions.edits.length)));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("The planner could not reach the bridge:", error);
      this.publish({ ...this.state, error: message });
    }
  }

  /**
   * Say plainly when the bridge cannot do what the planner needs.
   *
   * Once per session: an old deployment, or one without the plan capability,
   * is a redeploy or a configuration change, not something that fixes itself
   * between two passes.
   */
  private async checkBridgeVersion(bridge: PlanBridgeConfig): Promise<void> {
    if (this.handshakeDone) return;
    this.handshakeDone = true;

    const health = await fetchHealth(bridge);
    if (health.protocol < PLAN_PROTOCOL_VERSION) {
      throw new Error(t().planner.bridgeOutdated(health.protocol, PLAN_PROTOCOL_VERSION));
    }
    if (!health.capabilities.includes("plan")) {
      throw new Error(t().planner.bridgeWithoutPlan);
    }
  }

  /** The reminder queue for every member marked for it, with its deadline. */
  private withQueue(plan: PlanDocument, bound: Map<string, VaultTask>): PlanDocument {
    const settings = this.getSettings();
    const desired = new Map<string, ReminderFields>();

    for (const block of plan.blocks) {
      for (const member of block.members) {
        if (!member.remind) continue;
        const task = bound.get(member.key);
        if (!task) continue;
        desired.set(member.key, {
          title: task.text,
          notes: `↩ ${noteName(task.path)}\n${taskUrl(member.key)}`,
          due: task.due ?? plan.deadlines[block.tag]?.date ?? null,
          done: task.done
        });
      }
    }

    return buildQueue(plan, desired, settings.plannerRemindersList);
  }

  // -------------------------------------------------------------------------
  // What the planner offers.

  async setTagDeadline(tag: string, date: string | null, capacity?: number): Promise<void> {
    await this.change((plan) => setDeadline(plan, tag, date, capacity));
  }

  /**
   * Puts a block in the calendar and records what belongs to it.
   *
   * The event is written first: it is the thing with an identity, and a plan
   * pointing at an event that was never created would be a plan that draws a
   * block nobody else can see.
   */
  async planBlock(draft: {
    tag: string;
    title: string;
    start: Date;
    end: Date;
    calendar: string;
    tasks: readonly VaultTask[];
    remind: readonly VaultTask[];
    uid?: string;
  }): Promise<void> {
    const bridge = this.bridge();
    if (!bridge) return;

    try {
      const uid = await saveEvent(bridge, {
        ...(draft.uid === undefined ? {} : { uid: draft.uid }),
        title: draft.title,
        start: draft.start.toISOString(),
        end: draft.end.toISOString(),
        calendar: draft.calendar,
        notes: blockNotes(draft.tag)
      });

      await this.change((plan) => {
        const keyed = keysForTasks(plan, draft.tasks);
        const members: PlanMember[] = draft.tasks.map((task) => ({
          key: keyed.keys.get(task) ?? generateKey(),
          text: task.text,
          path: task.path,
          remind: draft.remind.includes(task),
          done: task.done
        }));
        const block: PlanBlock = {
          uid,
          tag: draft.tag,
          title: draft.title,
          start: draft.start.toISOString(),
          end: draft.end.toISOString(),
          calendar: draft.calendar,
          members
        };
        return upsertBlock(keyed.plan, block);
      });

      new Notice(t().common.notice(t().planner.blockPlanned(draft.title)));
    } catch (error) {
      this.report(error);
    }
  }

  async dropBlock(uid: string): Promise<void> {
    const bridge = this.bridge();
    const block = this.state.plan.blocks.find((one) => one.uid === uid);
    if (!bridge || !block) return;

    try {
      await deleteEvent(bridge, uid, block.calendar);
      await this.change((plan) => removeBlock(plan, uid));
    } catch (error) {
      this.report(error);
    }
  }

  async setBlockMembers(uid: string, members: readonly PlanMember[]): Promise<void> {
    await this.change((plan) => setMembers(plan, uid, members));
  }

  /** The days around a date, for the leaf's calendar. */
  async events(from: string, to: string): Promise<CalendarEvent[]> {
    const bridge = this.bridge();
    if (!bridge) return [];
    try {
      return await fetchEvents(bridge, from, to, this.getSettings().plannerCalendars);
    } catch (error) {
      this.report(error);
      return [];
    }
  }

  /** `obsidian://schreibstube?key=…` from a reminder: open the task's note. */
  async openKey(key: string): Promise<void> {
    const anchor = this.state.plan.anchors[key];
    const tasks = await this.scan(false);
    const match = matchAnchors(this.state.plan.anchors, tasks);
    const task = match.bound.get(key);
    const path = task?.path ?? anchor?.path;
    if (!path) {
      new Notice(t().common.notice(t().planner.taskNotFound));
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t().common.notice(t().planner.taskNotFound));
      return;
    }
    await this.app.workspace
      .getLeaf(false)
      .openFile(file, task ? { eState: { line: task.line } } : {});
  }

  /** A note renamed is not a task moved; Obsidian says so, so nothing is guessed. */
  async noteRenamed(from: string, to: string): Promise<void> {
    if (!this.configured()) return;
    this.scannedAt = 0;
    await this.change((plan) => ({ ...plan, anchors: renamedAnchors(plan.anchors, from, to) }));
  }

  invalidateScan(): void {
    this.scannedAt = 0;
  }

  // -------------------------------------------------------------------------

  /**
   * Applies a change to the plan and stores it.
   *
   * A bridge that has moved on refuses the write and hands back what it
   * holds; the change is then redone on top of that, once. Two people
   * planning the same minute is rare, and losing an afternoon to a silent
   * overwrite is not worth the simpler code.
   */
  private async change(edit: (plan: PlanDocument) => PlanDocument): Promise<void> {
    const bridge = this.bridge();
    if (!bridge) return;

    try {
      const next = edit(this.state.plan);
      this.publish({ ...this.state, plan: next });
      await this.push(next, edit);
    } catch (error) {
      this.report(error);
    }
  }

  private async push(
    plan: PlanDocument,
    redo?: (plan: PlanDocument) => PlanDocument
  ): Promise<void> {
    const bridge = this.bridge();
    if (!bridge) return;

    try {
      const stored = await savePlan(bridge, this.rev, plan);
      this.rev = stored.rev;
    } catch (error) {
      if (!(error instanceof PlanConflict) || !redo) throw error;
      this.rev = error.stored.rev;
      const merged = redo(error.stored.plan);
      const stored = await savePlan(bridge, this.rev, merged);
      this.rev = stored.rev;
      this.publish({ ...this.state, plan: merged });
    }
  }

  /** Ticks or reopens the tasks a drain reported from Reminders. */
  private async applyEdits(edits: readonly { path: string; line: number; done: boolean }[]) {
    const byPath = new Map<string, { line: number; done: boolean }[]>();
    for (const edit of edits) {
      byPath.set(edit.path, [...(byPath.get(edit.path) ?? []), edit]);
    }

    for (const [path, wanted] of byPath) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      await this.app.vault.process(file, (content) => {
        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        const lines = content.split(/\r?\n/);
        for (const edit of wanted) {
          const line = lines[edit.line];
          if (line === undefined) continue;
          lines[edit.line] = line.replace(
            /^(\s*(?:[-*+]|\d+[.)])\s+\[).\]/,
            `$1${edit.done ? "x" : " "}]`
          );
        }
        return lines.join(newline);
      });
    }
    if (edits.length > 0) this.scannedAt = 0;
  }

  /** Every task in the vault, from notes that could hold one. */
  private async scan(force: boolean): Promise<VaultTask[]> {
    if (!force && Date.now() - this.scannedAt < SCAN_TTL_MS && this.state.tasks.length > 0) {
      return this.state.tasks;
    }

    const tasks: VaultTask[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.mayHoldTasks(file)) continue;
      const content = await this.app.vault.cachedRead(file);
      if (!content.includes(TASK_SIGN)) continue;
      tasks.push(...tasksInNote(file.path, content));
    }

    this.scannedAt = Date.now();
    return tasks;
  }

  private mayHoldTasks(file: TFile): boolean {
    const cache = this.app.metadataCache?.getFileCache(file);
    if (!cache) return true;
    return cache.listItems?.some((item) => item.task !== undefined) ?? false;
  }

  private publish(state: PlannerState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn("The planner could not finish:", error);
    new Notice(t().common.notice(message));
    this.publish({ ...this.state, error: message });
  }

  /** The bridge's address and token, or nothing with the reason already said. */
  private bridge(): PlanBridgeConfig | null {
    const settings = this.getSettings();
    if (!settings.plannerEnabled) return null;

    const url = normalizeBaseUrl(settings.plannerBridgeUrl);
    if (!url.ok) {
      this.publish({ ...this.state, error: url.message });
      return null;
    }

    const token = resolveApiKey(
      this.app.secretStorage,
      settings.plannerTokenSecretName,
      t().secrets.planToken
    );
    if (!token.ok) {
      this.publish({ ...this.state, error: token.message });
      return null;
    }

    return { baseUrl: url.url, token: token.apiKey };
  }
}

/** Today, as the plan writes a day. */
export function today(): string {
  return dayKey(new Date());
}

/** Where a reminder points back to; the key is meaningless outside the plan. */
export function taskUrl(key: string): string {
  return `obsidian://schreibstube?key=${encodeURIComponent(key)}`;
}

/** A marker in the event's own notes, so any client can tell a block from a meeting. */
export function blockNotes(tag: string): string {
  return `schreibstube:block=${tag}`;
}

/** The tag a block carries, read back from a calendar event. */
export function blockTag(notes: string): string | null {
  return /schreibstube:block=([A-Za-z0-9][A-Za-z0-9/_-]*)/.exec(notes)?.[1] ?? null;
}

function noteName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

/** Which block a task sits in, for a view that marks planned tasks. */
export function plannedIn(plan: PlanDocument, key: string): PlanBlock | null {
  return blockOfKey(plan, key);
}
