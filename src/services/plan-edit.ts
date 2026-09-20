/**
 * Every change the planner makes to the plan, as a function of the plan.
 *
 * Nothing here talks to the bridge, the calendar or the vault: a change is
 * computed, then whoever asked for it sends the new document. That is what
 * makes "what happens when a task is reworded while it sits in a block"
 * something a test can answer.
 */
import {
  generateKey,
  MAX_MEMBERS,
  MAX_QUEUE,
  type Completion,
  type PlanBlock,
  type PlanDocument,
  type PlanMember,
  type QueueOp
} from "./plan-model";
import type { Anchor, MatchResult } from "./task-identity";
import { anchorFor } from "./task-identity";
import type { Tag, VaultTask } from "./task-inventory";

export function setDeadline(
  plan: PlanDocument,
  tag: Tag,
  date: string | null,
  capacity?: number
): PlanDocument {
  const deadlines = { ...plan.deadlines };
  if (date === null) delete deadlines[tag];
  else deadlines[tag] = capacity === undefined ? { date } : { date, capacity };
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

export function setMembers(
  plan: PlanDocument,
  uid: string,
  members: readonly PlanMember[]
): PlanDocument {
  return {
    ...plan,
    blocks: plan.blocks.map((block) =>
      block.uid === uid ? { ...block, members: members.slice(0, MAX_MEMBERS) } : block
    )
  };
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

export interface ReminderFields {
  title: string;
  notes: string;
  due: string | null;
  done: boolean;
}

/**
 * The reminder queue after this pass.
 *
 * Only members marked for Reminders are in it, and an operation is added only
 * when what Reminders should hold differs from the last operation for that
 * key — so a queue that has caught up stays empty of new work however often
 * this runs. Applied operations are kept as that record of what was sent,
 * and the oldest are dropped once the queue is full.
 */
export function buildQueue(
  plan: PlanDocument,
  desired: Map<string, ReminderFields>,
  list: string
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
    if (desired.has(key) || previous.op === "delete") continue;
    seq += 1;
    added.push({ seq, op: "delete", key });
  }

  if (added.length === 0) return plan;

  const merged = [...plan.queue.filter((op) => !added.some((one) => one.key === op.key)), ...added];
  return { ...plan, queue: merged.slice(-MAX_QUEUE) };
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
