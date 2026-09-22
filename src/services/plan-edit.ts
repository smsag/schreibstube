/**
 * Every change the planner makes to the plan, as a function of the plan.
 *
 * Nothing here talks to the bridge, the calendar or the vault: a change is
 * computed, then whoever asked for it sends the new document. That is what
 * makes "what happens when a task is reworded while it sits in a block"
 * something a test can answer.
 */
import {
  clampCapacity,
  generateKey,
  MAX_MEMBERS,
  MAX_QUEUE,
  type Completion,
  type PlanBlock,
  type PlanDocument,
  type QueueOp
} from "./plan-model";
import type { Anchor, MatchResult } from "./task-identity";
import { anchorFor } from "./task-identity";
import type { Tag, VaultTask } from "./task-inventory";
import { taskMarker } from "./task-summary";

export function setDeadline(
  plan: PlanDocument,
  tag: Tag,
  date: string | null,
  capacity?: number
): PlanDocument {
  const deadlines = { ...plan.deadlines };
  if (date === null) delete deadlines[tag];
  else
    deadlines[tag] =
      capacity === undefined ? { date } : { date, capacity: clampCapacity(capacity) };
  return { ...plan, deadlines };
}

/** Adds a block, or replaces the one with the same calendar event. */
export function upsertBlock(plan: PlanDocument, block: PlanBlock): PlanDocument {
  const kept = plan.blocks.filter((existing) => existing.uid !== block.uid);
  return {
    ...plan,
    blocks: [...kept, { ...block, members: block.members.slice(0, MAX_MEMBERS) }]
  };
}

export function removeBlock(plan: PlanDocument, uid: string): PlanDocument {
  return { ...plan, blocks: plan.blocks.filter((block) => block.uid !== uid) };
}

/**
 * Keys for tasks the plan is about to hold on to.
 *
 * A task the plan already knows keeps its key, so planning the same task into
 * a later block does not make a second one. Anything else gets a fresh key
 * and an anchor recording how the task reads today.
 */
export function keysForTasks(
  plan: PlanDocument,
  tasks: readonly VaultTask[],
  nextKey: () => string = generateKey
): { plan: PlanDocument; keys: Map<VaultTask, string> } {
  const anchors: Record<string, Anchor> = { ...plan.anchors };
  const keys = new Map<VaultTask, string>();
  const byAnchor = new Map<string, string>();
  for (const [key, anchor] of Object.entries(anchors)) {
    byAnchor.set(anchorId(anchor), key);
  }

  for (const task of tasks) {
    const seen = byAnchor.get(anchorId(task));
    const key = seen ?? fresh(anchors, nextKey);
    anchors[key] = anchorFor(task);
    byAnchor.set(anchorId(task), key);
    keys.set(task, key);
  }

  return { plan: { ...plan, anchors }, keys };
}

/**
 * One task's place, as a string to look up by: the ordinal and the hash
 * cannot hold a colon, so whatever a note is called the three parts stay
 * unambiguous.
 */
function anchorId(at: { path: string; hash: string; ordinal: number }): string {
  return `${at.ordinal}:${at.hash}:${at.path}`;
}

/** A key nothing else uses; at 36^10 a second draw is already a formality. */
function fresh(anchors: Record<string, Anchor>, nextKey: () => string): string {
  let key = nextKey();
  for (let attempt = 0; attempt < 20 && anchors[key] !== undefined; attempt += 1) key = nextKey();
  return key;
}

/**
 * The plan after a fresh scan of the vault.
 *
 * Anchors move with the tasks they were matched to, a member's wording is
 * refreshed so the planner and the widget show what the note says now, and
 * completion is taken from the note, which is where a person ticks things.
 * A member whose task was not found keeps its place: it is reported, not
 * dropped, because a note that failed to load is not a task that was deleted.
 */
export function applyMatch(plan: PlanDocument, match: MatchResult): PlanDocument {
  const blocks = plan.blocks.map((block) => ({
    ...block,
    members: block.members.map((member) => {
      const task = match.bound.get(member.key);
      if (!task) return member;
      return { ...member, text: task.text, path: task.path, done: task.done };
    })
  }));

  return { ...plan, anchors: match.anchors, blocks };
}

/** Anchors for keys the plan no longer refers to anywhere; they only take space. */
export function pruneAnchors(plan: PlanDocument): PlanDocument {
  const used = new Set<string>();
  for (const block of plan.blocks) for (const member of block.members) used.add(member.key);
  for (const op of plan.queue) used.add(op.key);
  for (const completion of plan.completions) used.add(completion.key);

  const anchors: Record<string, Anchor> = {};
  for (const [key, anchor] of Object.entries(plan.anchors)) {
    if (used.has(key)) anchors[key] = anchor;
  }
  return { ...plan, anchors };
}

/**
 * The vault tasks already sitting in an open slot of some block.
 *
 * Decided by key, the way the plan decides everything else: a task reworded
 * since it was planned is still the same task, and one of two identically
 * worded lines is not the other.
 */
export function plannedTasks(plan: PlanDocument, bound: Map<string, VaultTask>): Set<VaultTask> {
  const planned = new Set<VaultTask>();
  for (const block of plan.blocks) {
    for (const member of block.members) {
      if (member.done) continue;
      const task = bound.get(member.key);
      if (task) planned.add(task);
    }
  }
  return planned;
}

export interface ReminderFields {
  title: string;
  notes: string;
  due: string | null;
  done: boolean;
}

/**
 * The reminder queue after this pass.
 *
 * The last operation for each key is the record of what Reminders was told,
 * so an operation is added only when that differs from what it should hold —
 * a queue that has caught up stays empty of new work however often this runs.
 *
 * `unknown` holds the keys whose task could not be found this pass. Their
 * reminders are left exactly as they are: a note that has not synced to this
 * device yet is not a task that was deleted, and deleting its reminder would
 * be the one change a person cannot see coming.
 *
 * The queue is bounded, and a record is never evicted while its reminder may
 * still exist. Only deletes a drain has already applied make room; when there
 * is still none, a task not yet in Reminders waits rather than pushing out a
 * reminder the plan would then lose track of.
 */
export function buildQueue(
  plan: PlanDocument,
  desired: Map<string, ReminderFields>,
  list: string,
  unknown: ReadonlySet<string> = new Set()
): PlanDocument {
  const last = new Map<string, QueueOp>();
  for (const op of plan.queue) last.set(op.key, op);

  let seq = plan.queue.reduce((highest, op) => Math.max(highest, op.seq), plan.acked);
  const added: QueueOp[] = [];

  for (const [key, fields] of desired) {
    const previous = last.get(key);
    if (
      previous?.op === "upsert" &&
      previous.title === fields.title &&
      previous.notes === fields.notes &&
      (previous.due ?? null) === fields.due &&
      previous.done === fields.done &&
      previous.list === list
    ) {
      continue;
    }
    seq += 1;
    added.push({ seq, op: "upsert", key, ...fields, list });
  }

  for (const [key, previous] of last) {
    if (desired.has(key) || unknown.has(key) || previous.op === "delete") continue;
    seq += 1;
    added.push({ seq, op: "delete", key });
  }

  if (added.length === 0) return plan;

  const replaced = new Set(added.map((op) => op.key));
  let queue = [...plan.queue.filter((op) => !replaced.has(op.key)), ...added];

  if (queue.length > MAX_QUEUE) {
    queue = queue.filter((op) => !(op.op === "delete" && op.seq <= plan.acked));
  }
  if (queue.length > MAX_QUEUE) {
    const room = MAX_QUEUE - queue.filter((op) => last.has(op.key)).length;
    let admitted = 0;
    queue = queue.filter((op) => last.has(op.key) || (admitted += 1) <= room);
  }

  return { ...plan, queue };
}

export interface NoteEdit {
  path: string;
  line: number;
  done: boolean;
}

/**
 * What a drain reported from Reminders, turned into edits for the notes.
 *
 * A completion whose task cannot be found is kept for the next pass rather
 * than thrown away: the note may simply not have synced to this device yet.
 * Everything else is consumed, because the note now says what Reminders said.
 */
export function takeCompletions(
  plan: PlanDocument,
  bound: Map<string, VaultTask>
): { plan: PlanDocument; edits: NoteEdit[] } {
  const edits: NoteEdit[] = [];
  const kept: Completion[] = [];

  for (const completion of plan.completions) {
    const task = bound.get(completion.key);
    if (!task) {
      kept.push(completion);
      continue;
    }
    if (task.done !== completion.done) {
      edits.push({ path: task.path, line: task.line, done: completion.done });
    }
  }

  return { plan: { ...plan, completions: kept }, edits };
}

const BOX = /^(\s*(?:[-*+]|\d+[.)])\s+\[).\]/;

/**
 * A note with the reported completions written into it.
 *
 * Only an open box is ticked and only an `x` is reopened. A box someone
 * marked otherwise — cancelled, deferred, anything Tasks or a theme gives a
 * meaning — says more than "done" or "not done", and what someone wrote in
 * the box is theirs. Returns how many lines actually changed.
 */
export function setTaskDone(
  content: string,
  edits: readonly { line: number; done: boolean }[]
): { content: string; changed: number } {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let changed = 0;

  for (const edit of edits) {
    const line = lines[edit.line];
    if (line === undefined) continue;
    const marker = taskMarker(line);
    const flips = edit.done ? marker === " " : marker === "x" || marker === "X";
    if (!flips) continue;
    lines[edit.line] = line.replace(BOX, `$1${edit.done ? "x" : " "}]`);
    changed += 1;
  }

  return { content: changed > 0 ? lines.join(newline) : content, changed };
}
