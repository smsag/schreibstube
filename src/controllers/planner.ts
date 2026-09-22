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
  blockNotes,
  emptyPlan,
  generateKey,
  taskUrl,
  type PlanBlock,
  type PlanDocument,
  type PlanMember
} from "../services/plan-model";
import {
  applyMatch,
  buildQueue,
  keysForTasks,
  plannedTasks,
  pruneAnchors,
  removeBlock,
  setDeadline,
  setTaskDone,
  takeCompletions,
  upsertBlock,
  type NoteEdit,
  type ReminderFields
} from "../services/plan-edit";
import { matchAnchors, renamedAnchors } from "../services/task-identity";
import { noteName, tasksInNote, type VaultTask } from "../services/task-inventory";
import type { SchreibstubeSettings } from "../types";

/** How long a plan on screen is trusted before it is asked for again. */
export const PLAN_REFRESH_MS = 5 * 60_000;

/** Signs a note may hold a task at all, before its lines are read. */
const TASK_SIGN = "- [";

/**
 * How often a refused write is redone on the plan that won. Twice covers two
 * devices writing at once; past that something is wrong, and saying so beats
 * looping.
 */
const WRITE_ATTEMPTS = 3;

export interface PlannerState {
  plan: PlanDocument;
  tasks: VaultTask[];
  /** Each key the plan refers to, with the task it was found as this pass. */
  bound: Map<string, VaultTask>;
  /** Tasks already in an open slot of some block, so they are not offered twice. */
  planned: Set<VaultTask>;
  /** Keys the plan refers to whose task could not be found in the vault. */
  lost: string[];
  /** When the bridge last answered; null until it has, once. */
  loadedAt: number | null;
  error: string | null;
}

interface ScannedNote {
  mtime: number;
  tasks: VaultTask[];
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
 * Every write to the plan goes through one queue, refresh included: a
 * refresh that read the plan before a block was planned must not be able to
 * store what it read over the block. And what is shown is what the bridge
 * accepted — a change it refused is reported, not left on screen as if it
 * had happened.
 *
 * Notes are written in exactly one case: a task Reminders reported as done.
 */
export class Planner {
  private state: PlannerState = {
    plan: emptyPlan(),
    tasks: [],
    bound: new Map(),
    planned: new Set(),
    lost: [],
    loadedAt: null,
    error: null
  };
  private rev = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private refreshing: Promise<void> | null = null;
  private handshakeDone = false;
  private readonly notes = new Map<string, ScannedNote>();
  private readonly stale = new Set<string>();
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

  /** Whether the plan on screen is older than `maxAgeMs`, or was never loaded. */
  isStale(maxAgeMs: number): boolean {
    return this.state.loadedAt === null || Date.now() - this.state.loadedAt > maxAgeMs;
  }

  /**
   * Reads the vault and the bridge, reconciles them and publishes the result.
   *
   * A second caller while one pass is waiting or running gets that pass; it
   * would read the same plan and the same notes.
   */
  refresh(): Promise<void> {
    if (!this.configured()) return Promise.resolve();
    this.refreshing ??= this.serial(() => this.runRefresh()).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async runRefresh(): Promise<void> {
    const bridge = this.bridge();
    if (!bridge) return;

    try {
      await this.checkBridgeVersion(bridge);
      let ticked = 0;
      for (let attempt = 1; ; attempt += 1) {
        try {
          ticked += await this.reconcile(bridge);
          break;
        } catch (error) {
          // Another device wrote between our read and our write. Starting the
          // pass over reads what it wrote; the notes it ticked stay ticked.
          if (!(error instanceof PlanConflict) || attempt >= WRITE_ATTEMPTS) throw error;
        }
      }
      if (ticked > 0) new Notice(t().common.notice(t().planner.ticked(ticked)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("The planner could not reach the bridge:", error);
      this.publish({ ...this.state, error: message });
    }
  }

  /** One read-reconcile-write against the bridge; returns how many notes it ticked. */
  private async reconcile(bridge: PlanBridgeConfig): Promise<number> {
    const [stored, scanned] = await Promise.all([fetchPlan(bridge), this.scan()]);
    let tasks = scanned;
    let match = matchAnchors(stored.plan.anchors, tasks);

    const completions = takeCompletions(stored.plan, match.bound);
    const ticked = await this.applyEdits(completions.edits);
    if (completions.edits.length > 0) {
      // The pass that ticked a note must show and send the ticked state, not
      // the one it read before writing it.
      tasks = await this.scan();
      match = matchAnchors(stored.plan.anchors, tasks);
    }

    const plan = pruneAnchors(this.withQueue(applyMatch(completions.plan, match), match.bound));
    if (JSON.stringify(plan) !== JSON.stringify(stored.plan)) {
      this.rev = (await savePlan(bridge, stored.rev, plan)).rev;
    } else {
      this.rev = stored.rev;
    }

    this.publish({
      plan,
      tasks,
      bound: match.bound,
      planned: plannedTasks(plan, match.bound),
      lost: match.lost,
      loadedAt: Date.now(),
      error: null
    });
    return ticked;
  }

  /**
   * Say plainly when the bridge cannot do what the planner needs.
   *
   * Once per session once it has answered: an old deployment, or one without
   * the plan capability, is a redeploy or a configuration change. A bridge
   * that did not answer at all is asked again next time.
   */
  private async checkBridgeVersion(bridge: PlanBridgeConfig): Promise<void> {
    if (this.handshakeDone) return;

    const health = await fetchHealth(bridge);
    if (health.protocol < PLAN_PROTOCOL_VERSION) {
      throw new Error(t().planner.bridgeOutdated(health.protocol, PLAN_PROTOCOL_VERSION));
    }
    if (!health.capabilities.includes("plan")) {
      throw new Error(t().planner.bridgeWithoutPlan);
    }
    this.handshakeDone = true;
  }

  /**
   * The reminder queue for every member marked for it, with its deadline.
   *
   * A marked member whose task was not found this pass is passed on as
   * unknown, so its reminder is left alone rather than deleted.
   */
  private withQueue(plan: PlanDocument, bound: Map<string, VaultTask>): PlanDocument {
    const settings = this.getSettings();
    const desired = new Map<string, ReminderFields>();
    const unknown = new Set<string>();

    for (const block of plan.blocks) {
      for (const member of block.members) {
        if (!member.remind) continue;
        const task = bound.get(member.key);
        if (!task) {
          unknown.add(member.key);
          continue;
        }
        desired.set(member.key, {
          title: task.text,
          notes: `↩ ${noteName(task.path)}\n${taskUrl(member.key)}`,
          due: task.due ?? plan.deadlines[block.tag]?.date ?? null,
          done: task.done
        });
      }
    }

    return buildQueue(plan, desired, settings.plannerRemindersList, unknown);
  }

  // -------------------------------------------------------------------------
  // What the planner offers.

  async setTagDeadline(tag: string, date: string | null, capacity?: number): Promise<void> {
    try {
      await this.commit((plan) => setDeadline(plan, tag, date, capacity));
    } catch (error) {
      this.report(error);
    }
  }

  /**
   * Puts a block in the calendar and records what belongs to it.
   *
   * The event is written first: it is the thing with an identity, and a plan
   * pointing at an event that was never created would draw a block nobody
   * else can see. When the plan then cannot be stored, the event is taken out
   * again, so the calendar does not keep a block the plan knows nothing about.
   */
  async planBlock(draft: {
    tag: string;
    title: string;
    start: Date;
    end: Date;
    calendar: string;
    tasks: readonly VaultTask[];
    remind: readonly VaultTask[];
  }): Promise<void> {
    const bridge = this.bridge();
    if (!bridge) return;

    let uid: string;
    try {
      uid = await saveEvent(bridge, {
        title: draft.title,
        start: draft.start.toISOString(),
        end: draft.end.toISOString(),
        calendar: draft.calendar,
        notes: blockNotes(draft.tag)
      });
    } catch (error) {
      this.report(error);
      return;
    }

    // The keys this block gave its tasks, so the plan on screen knows them as
    // soon as it is stored rather than after the next pass.
    let keys = new Map<VaultTask, string>();
    try {
      await this.commit(
        (plan) => {
          const keyed = keysForTasks(plan, draft.tasks);
          keys = keyed.keys;
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
        },
        () => keys
      );
      new Notice(t().common.notice(t().planner.blockPlanned(draft.title)));
    } catch (error) {
      await deleteEvent(bridge, uid, draft.calendar).catch((undo: unknown) => {
        this.logger.warn("A block's event could not be taken out again:", undo);
      });
      this.report(error);
    }
  }

  /**
   * Takes a block out of the plan, then out of the calendar. In that order:
   * an event left behind is a block anyone can still see and delete by hand;
   * a block left pointing at a missing event is one nothing can see at all.
   */
  async dropBlock(uid: string): Promise<void> {
    const bridge = this.bridge();
    const block = this.state.plan.blocks.find((one) => one.uid === uid);
    if (!bridge || !block) return;

    try {
      await this.commit((plan) => removeBlock(plan, uid));
      await deleteEvent(bridge, uid, block.calendar);
    } catch (error) {
      this.report(error);
    }
  }

  /** The calendar's events from one day to another, both included, as the bridge counts. */
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

  /**
   * `obsidian://schreibstube?key=…` from a reminder: open the task's note.
   *
   * A tap on a reminder can start Obsidian, and the plan is not there yet
   * when the link arrives, so a key not yet known is looked for with a pass. Without the bridge,
   * the note the plan last saw the task in is still the best answer.
   */
  async openKey(key: string): Promise<void> {
    if (!this.configured()) return;
    if (!this.state.bound.has(key)) await this.refresh();

    const task = this.state.bound.get(key);
    const path = task?.path ?? this.state.plan.anchors[key]?.path;
    const file = path === undefined ? null : this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t().common.notice(t().planner.taskNotFound));
      return;
    }
    await this.app.workspace
      .getLeaf(false)
      .openFile(file, task ? { eState: { line: task.line } } : {});
  }

  /**
   * A note renamed is not a task moved; Obsidian says so, so nothing is
   * guessed. Only a rename the plan refers to is written, and quietly: a
   * folder moved is many renames, and none of them was a request to plan.
   */
  async noteRenamed(from: string, to: string): Promise<void> {
    this.notes.delete(from);
    if (!this.configured()) return;
    const refers = Object.values(this.state.plan.anchors).some((anchor) => anchor.path === from);
    if (!refers) return;

    try {
      await this.commit((plan) => ({ ...plan, anchors: renamedAnchors(plan.anchors, from, to) }));
    } catch (error) {
      this.logger.warn(`The plan could not follow ${from} to ${to}:`, error);
      this.publish({
        ...this.state,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /** A note changed; its tasks are read again on the next pass, and only its. */
  noteChanged(path: string): void {
    this.stale.add(path);
  }

  // -------------------------------------------------------------------------

  /** Runs `work` after every write already queued, and before any queued later. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writes.then(work, work);
    this.writes = run.catch(() => undefined);
    return run;
  }

  /**
   * Applies a change to the plan and stores it, then shows it.
   *
   * A bridge that has moved on refuses the write and hands back what it
   * holds; the change is then redone on top of that. Nothing is published
   * until the bridge has accepted it, so a refused change is an error on
   * screen rather than a change that silently vanishes on the next pass.
   */
  private commit(
    edit: (plan: PlanDocument) => PlanDocument,
    boundBy: () => Map<VaultTask, string> = () => new Map()
  ): Promise<void> {
    return this.serial(async () => {
      const bridge = this.bridge();
      if (!bridge) return;

      let base = this.state.plan;
      let rev = this.rev;
      for (let attempt = 1; ; attempt += 1) {
        const next = edit(base);
        try {
          this.rev = (await savePlan(bridge, rev, next)).rev;
          const bound = new Map(this.state.bound);
          for (const [task, key] of boundBy()) bound.set(key, task);
          this.publish({
            ...this.state,
            plan: next,
            bound,
            planned: plannedTasks(next, bound),
            error: null
          });
          return;
        } catch (error) {
          if (!(error instanceof PlanConflict) || attempt >= WRITE_ATTEMPTS) throw error;
          base = error.stored.plan;
          rev = error.stored.rev;
        }
      }
    });
  }

  /** Ticks or reopens the tasks a drain reported; returns how many lines changed. */
  private async applyEdits(edits: readonly NoteEdit[]): Promise<number> {
    const byPath = new Map<string, NoteEdit[]>();
    for (const edit of edits) byPath.set(edit.path, [...(byPath.get(edit.path) ?? []), edit]);

    let changed = 0;
    for (const [path, wanted] of byPath) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      await this.app.vault.process(file, (content) => {
        const result = setTaskDone(content, wanted);
        changed += result.changed;
        return result.content;
      });
      this.stale.add(path);
    }
    return changed;
  }

  /**
   * Every task in the vault, from notes that could hold one.
   *
   * A note is read again only when it changed since it was last read; the
   * list of notes itself is walked every time, which is how a note created
   * or deleted since is noticed without an event for either.
   */
  private async scan(): Promise<VaultTask[]> {
    const seen = new Set<string>();
    const reads: Promise<void>[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.mayHoldTasks(file)) continue;
      seen.add(file.path);
      const known = this.notes.get(file.path);
      if (known && known.mtime === file.stat.mtime && !this.stale.has(file.path)) continue;

      reads.push(
        this.app.vault.cachedRead(file).then((content) => {
          this.notes.set(file.path, {
            mtime: file.stat.mtime,
            tasks: content.includes(TASK_SIGN) ? tasksInNote(file.path, content) : []
          });
          this.stale.delete(file.path);
        })
      );
    }
    await Promise.all(reads);

    for (const path of this.notes.keys()) if (!seen.has(path)) this.notes.delete(path);
    return [...this.notes.values()].flatMap((note) => note.tasks);
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
