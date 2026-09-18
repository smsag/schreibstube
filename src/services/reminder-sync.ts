/**
 * Keeping one Reminders list in agreement with the vault.
 *
 * The plugin cannot reach Reminders. A Shortcut can, so the two talk through
 * two files in the vault: the plugin writes an outbox of operations, the
 * Shortcut applies them and writes back an inbox, a snapshot of every
 * reminder in the list. All the deciding happens here — what changed, which
 * side changed it, what to tick — and the Shortcut stays a loop that does
 * what it is told, so it rarely has to change and never has to be clever.
 *
 * Who wins:
 * - The note owns the title, the notes and the due date. An edit in Reminders
 *   is overwritten the next time the task changes in the note.
 * - Completion goes both ways. When both sides moved since the last look,
 *   Reminders wins: ticking a reminder is the more deliberate act.
 * - A task deleted from the vault, or no longer a reminder, deletes its
 *   reminder. A reminder deleted in Reminders detaches its task, which is not
 *   sent again until it is edited.
 *
 * Operations are idempotent — an upsert finds its reminder by the id in its
 * notes before it creates one — so an outbox applied twice, or by two devices,
 * does no harm. The outbox holds every operation not yet confirmed, merged by
 * id, and a sequence number the inbox echoes back to confirm them.
 *
 * Text and plain objects in and out; nothing here touches the vault.
 */
import { taskMatch, type NoteTask } from "./reminder-tasks";

export const SYNC_FORMAT_VERSION = 1;

/** Bounds on what the inbox may hand the plugin; a Shortcut writes it, so it is untrusted. */
export const MAX_INBOX_REMINDERS = 5000;
const MAX_FIELD_CHARS = 10_000;

export type SyncOp =
  | {
      op: "upsert";
      id: string;
      /** What the reminder's notes contain exactly when it is this one. */
      match: string;
      title: string;
      notes: string;
      /** `YYYY-MM-DD`, or null for no due date. */
      due: string | null;
      /** Present only when the note changed completion; absent leaves it as it is. */
      done?: boolean;
    }
  | { op: "delete"; id: string; match: string };

export interface Outbox {
  v: number;
  seq: number;
  list: string;
  ops: SyncOp[];
}

export interface ObservedReminder {
  id: string;
  done: boolean;
  title: string;
}

export interface Inbox {
  /** The outbox sequence the Shortcut had applied when it took the snapshot. */
  appliedSeq: number;
  /** When the snapshot was taken, in ms; 0 when the Shortcut did not say. */
  at: number;
  reminders: ObservedReminder[];
}

export interface KnownReminder {
  /** Completion as both sides last agreed on it. */
  done: boolean;
  /** Title, notes and due date as last sent, to tell a note edit from no edit. */
  sig: string;
  /** The outbox sequence that last sent it; a snapshot older than this cannot see it. */
  since: number;
  /** Deleted in Reminders; not sent again until the task changes. */
  detached: boolean;
}

export interface SyncState {
  v: number;
  seq: number;
  /** The newest snapshot already taken into account, by its `at`. */
  observedAt: number;
  pending: Record<string, SyncOp>;
  known: Record<string, KnownReminder>;
}

export function emptyState(): SyncState {
  return { v: SYNC_FORMAT_VERSION, seq: 0, observedAt: 0, pending: {}, known: {} };
}

export interface NoteChange {
  id: string;
  path: string;
  done: boolean;
}

export interface ReconcileResult {
  state: SyncState;
  /** Tasks whose box Reminders says should change. */
  changes: NoteChange[];
  /** Ids whose reminder was deleted in Reminders during this pass. */
  detached: string[];
}

/** Title, notes and due date: the fields the note owns. */
export function signature(task: Pick<NoteTask, "title" | "notes" | "due">): string {
  return JSON.stringify([task.title, task.notes, task.due]);
}

function upsert(task: NoteTask, done?: boolean): SyncOp {
  const op: SyncOp = {
    op: "upsert",
    id: task.id,
    match: taskMatch(task.id),
    title: task.title,
    notes: task.notes,
    due: task.due
  };
  if (done !== undefined) op.done = done;
  return op;
}

/** A later operation for the same reminder replaces an earlier one, keeping a completion it did not restate. */
function merge(earlier: SyncOp | undefined, later: SyncOp): SyncOp {
  if (earlier?.op !== "upsert" || later.op !== "upsert") return later;
  if (later.done !== undefined || earlier.done === undefined) return later;
  return { ...later, done: earlier.done };
}

export interface ReconcileInput {
  /** Every reminder task in the vault, one per id. */
  tasks: readonly NoteTask[];
  /** The latest inbox, or null when there is none yet. */
  inbox: Inbox | null;
  state: SyncState;
}

export function reconcile({ tasks, inbox, state }: ReconcileInput): ReconcileResult {
  const next: SyncState = {
    ...state,
    pending: { ...state.pending },
    known: Object.fromEntries(Object.entries(state.known).map(([id, k]) => [id, { ...k }]))
  };

  // A snapshot counts once: the inbox is read on every pass, and an old one
  // would otherwise keep reopening tasks the note has since ticked.
  const fresh = inbox !== null && (inbox.at === 0 || inbox.at > state.observedAt);
  const observed = fresh ? new Map(inbox.reminders.map((r) => [r.id, r])) : null;
  const applied = fresh ? inbox.appliedSeq : -1;
  if (fresh) {
    next.observedAt = Math.max(state.observedAt, inbox.at);
    if (inbox.appliedSeq >= state.seq) next.pending = {};
  }

  // An empty list where reminders were known is a list the Shortcut could not
  // find, not a person deleting everything at once.
  const attachedKnown = Object.values(state.known).some((k) => !k.detached && k.since <= applied);
  const trustAbsence = observed !== null && (observed.size > 0 || !attachedKnown);

  const seq = state.seq + 1;
  const ops: Record<string, SyncOp> = {};
  const changes: NoteChange[] = [];
  const detached: string[] = [];
  const byId = new Map(tasks.map((task) => [task.id, task]));

  for (const task of tasks) {
    const known = next.known[task.id];
    const sig = signature(task);

    if (!known) {
      // A task that is already done needs no reminder.
      if (task.done) continue;
      ops[task.id] = upsert(task);
      next.known[task.id] = { done: false, sig, since: seq, detached: false };
      continue;
    }

    if (known.detached) {
      if (sig === known.sig) continue;
      ops[task.id] = upsert(task, task.done);
      next.known[task.id] = { done: task.done, sig, since: seq, detached: false };
      continue;
    }

    // What the snapshot says about this reminder only counts when the snapshot
    // is new enough to have seen the last operation for it.
    const settled =
      observed !== null && next.pending[task.id] === undefined && known.since <= applied;
    const seen = settled ? observed.get(task.id) : undefined;

    if (settled && !seen && trustAbsence) {
      known.detached = true;
      detached.push(task.id);
      continue;
    }

    let sendDone: boolean | undefined;
    if (seen && seen.done !== known.done) {
      known.done = seen.done;
      if (task.done !== seen.done) changes.push({ id: task.id, path: task.path, done: seen.done });
    } else if (task.done !== known.done) {
      known.done = task.done;
      sendDone = task.done;
    }

    if (sig !== known.sig || sendDone !== undefined) {
      ops[task.id] = upsert(task, sendDone);
      known.sig = sig;
      known.since = seq;
    }
  }

  for (const [id, known] of Object.entries(state.known)) {
    if (byId.has(id)) continue;
    delete next.known[id];
    if (!known.detached) ops[id] = { op: "delete", id, match: taskMatch(id) };
  }

  const ids = Object.keys(ops);
  if (ids.length > 0) {
    next.seq = seq;
    for (const id of ids) next.pending[id] = merge(next.pending[id], ops[id]!);
  }

  return { state: next, changes, detached };
}

/** The outbox for a state: every operation not yet confirmed. */
export function buildOutbox(state: SyncState, list: string): Outbox {
  return {
    v: SYNC_FORMAT_VERSION,
    seq: state.seq,
    list,
    ops: Object.keys(state.pending)
      .sort()
      .map((id) => state.pending[id]!)
  };
}

/**
 * Every task the vault offers, one per id.
 *
 * The same block id in two notes would make one reminder answer for two
 * tasks. The first keeps it; the rest are left out and named, so the caller
 * can say which.
 */
export function uniqueTasks(tasks: readonly NoteTask[]): {
  tasks: NoteTask[];
  duplicates: NoteTask[];
} {
  const seen = new Set<string>();
  const unique: NoteTask[] = [];
  const duplicates: NoteTask[] = [];
  for (const task of tasks) {
    if (seen.has(task.id)) {
      duplicates.push(task);
      continue;
    }
    seen.add(task.id);
    unique.push(task);
  }
  return { tasks: unique, duplicates };
}

// ---------------------------------------------------------------------------
// Reading the files back. Both are in the vault, where a person, a sync client
// or a Shortcut can have written anything, so neither is trusted.

const ID_IN_NOTES = /schreibstube\?task=([A-Za-z0-9-]{1,64})/;
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : 0;
}

/** Shortcuts writes a Boolean as true, 1, "Yes", "Ja" or "true", depending on the path it took. */
function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  return ["true", "yes", "ja", "1"].includes(value.trim().toLowerCase());
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_FIELD_CHARS) : "";
}

function time(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The inbox a Shortcut wrote, or null when it is not one.
 *
 * Reminders are recognised by the link in their notes; anything in the list
 * without one — a reminder somebody added by hand — is not the sync's business.
 */
export function parseInbox(raw: string): Inbox | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const inbox = record(value);
  if (!inbox || !Array.isArray(inbox.reminders)) return null;

  const reminders: ObservedReminder[] = [];
  const seen = new Set<string>();
  for (const entry of inbox.reminders.slice(0, MAX_INBOX_REMINDERS)) {
    const item = record(entry);
    if (!item) continue;
    const id = ID_IN_NOTES.exec(text(item.notes))?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    reminders.push({ id, done: truthy(item.done), title: text(item.title) });
  }

  return { appliedSeq: count(inbox.appliedSeq), at: time(inbox.at), reminders };
}

function parseOp(value: unknown): SyncOp | null {
  const item = record(value);
  if (!item || typeof item.id !== "string" || !ID_PATTERN.test(item.id)) return null;
  const id = item.id;
  if (item.op === "delete") return { op: "delete", id, match: taskMatch(id) };
  if (item.op !== "upsert") return null;
  const op: SyncOp = {
    op: "upsert",
    id,
    match: taskMatch(id),
    title: text(item.title),
    notes: text(item.notes),
    due: typeof item.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.due) ? item.due : null
  };
  if (typeof item.done === "boolean") op.done = item.done;
  return op;
}

/** The sync state as the plugin left it, or an empty one when the file is missing or damaged. */
export function parseState(raw: string | null): SyncState {
  if (raw === null) return emptyState();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  const state = record(value);
  if (!state) return emptyState();

  const pending: Record<string, SyncOp> = {};
  for (const entry of Object.values(record(state.pending) ?? {})) {
    const op = parseOp(entry);
    if (op) pending[op.id] = op;
  }

  const known: Record<string, KnownReminder> = {};
  for (const [id, entry] of Object.entries(record(state.known) ?? {})) {
    const item = record(entry);
    if (!item || !ID_PATTERN.test(id)) continue;
    known[id] = {
      done: item.done === true,
      sig: text(item.sig),
      since: count(item.since),
      detached: item.detached === true
    };
  }

  return {
    v: SYNC_FORMAT_VERSION,
    seq: count(state.seq),
    observedAt: count(state.observedAt),
    pending,
    known
  };
}
