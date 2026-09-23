/**
 * The plan: what the day is meant to look like.
 *
 * A block is an hour in the calendar with a project tag on it and a list of
 * tasks that belong to it. The tasks themselves are untouched prose in notes;
 * the plan refers to them by key, and the keys' anchors are what make that
 * survive editing. None of it is written into the vault — the document lives
 * on the bridge, where the planner, a widget and a helper can all read it.
 *
 * The document arrives over HTTP from a service a person runs themselves, and
 * an app and a helper write to it too, so nothing in it is trusted: it is
 * normalised here, field by field, and anything unreadable is dropped rather
 * than carried further.
 */
import type { Anchor } from "./task-identity";
import type { Tag } from "./task-inventory";

export const PLAN_FORMAT_VERSION = 1;

/** Bounds mirroring the bridge's, so the plugin never offers what it would refuse. */
export const MAX_BLOCKS = 500;
export const MAX_MEMBERS = 200;
export const MAX_ANCHORS = 2000;
export const MAX_QUEUE = 500;
export const MAX_COMPLETIONS = 500;
/** How many tasks one block can be expected to take; the bridge refuses more. */
export const MAX_CAPACITY = 50;
const MAX_TEXT = 500;
const MAX_PATH = 400;

export interface PlanMember {
  key: string;
  /** The task's wording as it was when planned; refreshed on every pass. */
  text: string;
  path: string;
  /** Whether this one also belongs in Reminders. */
  remind: boolean;
  /** Completion as last known; the vault is authoritative while it is open. */
  done: boolean;
}

export interface PlanBlock {
  /** The calendar event's identifier: the block and the event are one thing. */
  uid: string;
  tag: Tag;
  title: string;
  /** ISO datetimes, as the calendar gave them. */
  start: string;
  end: string;
  calendar: string;
  members: PlanMember[];
}

export interface PlanDeadline {
  date: string;
  /** How many tasks of this project fit in one block. */
  capacity?: number;
}

export interface QueueOp {
  seq: number;
  op: "upsert" | "delete";
  key: string;
  title?: string;
  notes?: string;
  due?: string | null;
  done?: boolean;
  list?: string;
}

export interface Completion {
  key: string;
  done: boolean;
  at: string;
}

export interface PlanDocument {
  v: number;
  deadlines: Record<Tag, PlanDeadline>;
  blocks: PlanBlock[];
  anchors: Record<string, Anchor>;
  /** Reminder operations, newest last. Those at or below `acked` are done. */
  queue: QueueOp[];
  acked: number;
  /** What a drain saw ticked in Reminders, waiting to reach the notes. */
  completions: Completion[];
}

export function emptyPlan(): PlanDocument {
  return {
    v: PLAN_FORMAT_VERSION,
    deadlines: {},
    blocks: [],
    anchors: {},
    queue: [],
    acked: 0,
    completions: []
  };
}

const KEY = /^[A-Za-z0-9-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]{0,199}$/;
const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A key for a task the plan is about to refer to. Opaque, and never in a note. */
export function generateKey(random: () => number = Math.random): string {
  let key = "k-";
  for (let index = 0; index < 10; index += 1) {
    key += KEY_ALPHABET[Math.min(KEY_ALPHABET.length - 1, Math.floor(random() * 36))];
  }
  return key;
}

export function normalizePlan(value: unknown): PlanDocument {
  const raw = record(value);
  if (!raw) return emptyPlan();

  return {
    v: PLAN_FORMAT_VERSION,
    deadlines: normalizeDeadlines(record(raw.deadlines)),
    blocks: list(raw.blocks, MAX_BLOCKS, normalizeBlock),
    anchors: normalizeAnchors(record(raw.anchors)),
    queue: list(raw.queue, MAX_QUEUE, normalizeOp),
    acked: counter(raw.acked),
    completions: list(raw.completions, MAX_COMPLETIONS, normalizeCompletion)
  };
}

function normalizeDeadlines(raw: Record<string, unknown> | null): Record<Tag, PlanDeadline> {
  const deadlines: Record<Tag, PlanDeadline> = {};
  for (const [tag, value] of Object.entries(raw ?? {}).slice(0, 200)) {
    const entry = record(value);
    const date = text(entry?.date, 10);
    if (!TAG_PATTERN.test(tag) || !DATE.test(date)) continue;
    const capacity = counter(entry?.capacity);
    deadlines[tag] = capacity > 0 ? { date, capacity: clampCapacity(capacity) } : { date };
  }
  return deadlines;
}

function normalizeBlock(value: unknown): PlanBlock | null {
  const raw = record(value);
  const uid = text(raw?.uid, 200);
  const tag = text(raw?.tag, 200);
  const start = text(raw?.start, 40);
  const end = text(raw?.end, 40);
  if (uid === "" || !TAG_PATTERN.test(tag) || !isTime(start) || !isTime(end)) return null;

  return {
    uid,
    tag,
    title: text(raw?.title, MAX_TEXT),
    start,
    end,
    calendar: text(raw?.calendar, 200),
    members: list(raw?.members, MAX_MEMBERS, normalizeMember)
  };
}

function normalizeMember(value: unknown): PlanMember | null {
  const raw = record(value);
  const key = text(raw?.key, 64);
  if (!KEY.test(key)) return null;
  return {
    key,
    text: text(raw?.text, MAX_TEXT),
    path: text(raw?.path, MAX_PATH),
    remind: raw?.remind === true,
    done: raw?.done === true
  };
}

function normalizeAnchors(raw: Record<string, unknown> | null): Record<string, Anchor> {
  const anchors: Record<string, Anchor> = {};
  for (const [key, value] of Object.entries(raw ?? {}).slice(0, MAX_ANCHORS)) {
    const entry = record(value);
    const path = text(entry?.path, MAX_PATH);
    if (!KEY.test(key) || path === "") continue;
    anchors[key] = {
      path,
      hash: text(entry?.hash, 64),
      text: text(entry?.text, MAX_TEXT),
      ordinal: counter(entry?.ordinal)
    };
  }
  return anchors;
}

function normalizeOp(value: unknown): QueueOp | null {
  const raw = record(value);
  const key = text(raw?.key, 64);
  const op = raw?.op === "delete" ? "delete" : raw?.op === "upsert" ? "upsert" : null;
  if (!KEY.test(key) || op === null) return null;

  const normalized: QueueOp = { seq: counter(raw?.seq), op, key };
  if (op === "upsert") {
    normalized.title = text(raw?.title, MAX_TEXT);
    normalized.notes = text(raw?.notes, 4000);
    const due = text(raw?.due, 10);
    normalized.due = DATE.test(due) ? due : null;
    normalized.done = raw?.done === true;
    const listName = text(raw?.list, 200);
    if (listName !== "") normalized.list = listName;
  }
  return normalized;
}

function normalizeCompletion(value: unknown): Completion | null {
  const raw = record(value);
  const key = text(raw?.key, 64);
  if (!KEY.test(key)) return null;
  return { key, done: raw?.done === true, at: text(raw?.at, 40) };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list<T>(value: unknown, max: number, each: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const kept: T[] = [];
  for (const item of value.slice(0, max)) {
    const normalized = each(item);
    if (normalized) kept.push(normalized);
  }
  return kept;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

function counter(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function isTime(value: string): boolean {
  return value !== "" && !Number.isNaN(Date.parse(value));
}

// ---------------------------------------------------------------------------
// Reading the plan.

/**
 * Tasks per block as the bridge will accept it: a whole number from 1 to the
 * bound. A capacity typed as 2.5 or 100 would otherwise be refused on the
 * way out, and every later change to the plan with it.
 */
export function clampCapacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CAPACITY, Math.max(1, Math.round(value)));
}

/** The local calendar day of a moment, `YYYY-MM-DD`. */
export function dayKey(moment: Date): string {
  const year = moment.getFullYear();
  const month = `${moment.getMonth() + 1}`.padStart(2, "0");
  const day = `${moment.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The day `offset` days from `from`. */
export function shiftDay(from: Date, offset: number): Date {
  const moved = new Date(from);
  moved.setDate(moved.getDate() + offset);
  return moved;
}

/** Whole days from today to a date; negative once it has passed. */
export function daysUntil(date: string, today: Date): number {
  const target = new Date(`${date}T00:00:00`);
  const start = new Date(`${dayKey(today)}T00:00:00`);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

/** The blocks on one day, earliest first. */
export function blocksOn(plan: PlanDocument, day: string): PlanBlock[] {
  return plan.blocks
    .filter((block) => dayKey(new Date(block.start)) === day)
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}

/**
 * The block to put in front of someone: the one running now, else the next
 * one today, else the first one coming. A block does not stop being the
 * answer because a minute inside it has passed — that is the whole point of a
 * block rather than a due time.
 */
export function currentBlock(plan: PlanDocument, now: Date): PlanBlock | null {
  const moment = now.getTime();
  const sorted = [...plan.blocks].sort(
    (left, right) => Date.parse(left.start) - Date.parse(right.start)
  );
  const running = sorted.find(
    (block) => Date.parse(block.start) <= moment && Date.parse(block.end) > moment
  );
  return running ?? sorted.find((block) => Date.parse(block.start) > moment) ?? null;
}

// ---------------------------------------------------------------------------
// The block marker. A block is an event in a calendar anyone can open, so
// the event itself says it is one, and for which project; every client that
// reads the calendar can then tell a block from a meeting.

const BLOCK_MARKER = /schreibstube:block=([A-Za-z0-9][A-Za-z0-9/_-]*)/;

export function blockNotes(tag: Tag): string {
  return `schreibstube:block=${tag}`;
}

export function blockTag(notes: string): Tag | null {
  return BLOCK_MARKER.exec(notes)?.[1] ?? null;
}

/** The `obsidian://schreibstube` action every link back into the vault arrives on. */
export const TASK_PROTOCOL_ACTION = "schreibstube";

/** Where a reminder points back to; the key means nothing outside the plan. */
export function taskUrl(key: string): string {
  return `obsidian://${TASK_PROTOCOL_ACTION}?key=${encodeURIComponent(key)}`;
}

/**
 * What a link back into the vault asks for.
 *
 * A planner reminder carries a key. A reminder made by 1.35 or earlier carries
 * the id of the link it left at the end of its task's line; those reminders
 * still sit in people's lists, so their links keep working. Anything else,
 * including the old status callback, asks for nothing.
 */
export function linkTarget(
  params: Record<string, string>
): { key: string } | { legacy: string } | null {
  if (params.key !== undefined && KEY.test(params.key)) return { key: params.key };
  if (params.task !== undefined && KEY.test(params.task)) return { legacy: params.task };
  return null;
}
