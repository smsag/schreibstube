/**
 * What the planner suggests when you open it.
 *
 * A deadline five days away and forty tasks open is a fact the vault and the
 * plan already hold between them; turning it into "three mornings this week"
 * is arithmetic, and arithmetic belongs in a function that can be tested
 * against an invented week rather than against whatever this Tuesday looks
 * like.
 *
 * The rules, in order: never propose into time that is already taken, never
 * more blocks than the work needs, never past the deadline, and never a
 * second block for a project on a day that already has one. What is left is
 * offered earliest first, because a deadline rewards starting sooner.
 */
import { dayKey, daysUntil, shiftDay, type PlanDocument } from "./plan-model";
import type { Tag } from "./task-inventory";

/** More than this and it is not a plan for the week any more. */
export const MAX_PROPOSALS = 5;

export interface Busy {
  start: string;
  end: string;
  /** An all-day event marks the day, not the hours: a birthday is not a meeting. */
  allDay?: boolean;
}

export interface Preferences {
  /** When a block should start, in minutes from midnight. */
  startMinute: number;
  /** How long a block runs. */
  lengthMinutes: number;
  /** How many tasks are expected to fit in one. */
  capacity: number;
  /** Which weekdays may hold one, 0 = Sunday. */
  days: number[];
}

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_PREFERENCES: Preferences = {
  startMinute: 5 * 60 + 30,
  lengthMinutes: 60,
  capacity: 3,
  days: WEEKDAYS
};

export interface Proposal {
  tag: Tag;
  start: Date;
  end: Date;
}

export interface ProposalInput {
  tag: Tag;
  /** `YYYY-MM-DD`, or null when the project has no deadline. */
  deadline: string | null;
  openTasks: number;
  plan: PlanDocument;
  busy: readonly Busy[];
  preferences: Preferences;
  now: Date;
}

/**
 * The blocks worth offering for one project.
 *
 * With no deadline there is nothing to be late for, so nothing is proposed:
 * the planner asks for a deadline first, which is the decision only a person
 * can make.
 */
export function proposeBlocks({
  tag,
  deadline,
  openTasks,
  plan,
  busy,
  preferences,
  now
}: ProposalInput): Proposal[] {
  if (deadline === null || openTasks === 0) return [];

  const capacity = Math.max(1, preferences.capacity);
  const wanted = Math.min(MAX_PROPOSALS, Math.ceil(openTasks / capacity));
  const planned = new Set(
    plan.blocks.filter((block) => block.tag === tag).map((block) => dayKey(new Date(block.start)))
  );

  // Every span is parsed once for the whole run, not once per day it is
  // checked against; the plan's own blocks are taken time as much as the
  // calendar's events are.
  const taken = spans([...busy, ...plan.blocks]);

  const proposals: Proposal[] = [];
  for (let offset = 0; offset < 30 && proposals.length < wanted; offset += 1) {
    const day = shiftDay(now, offset);
    const key = dayKey(day);
    if (key > deadline) break;
    if (!preferences.days.includes(day.getDay()) || planned.has(key)) continue;

    const start = atMinute(day, preferences.startMinute);
    const end = new Date(start.getTime() + preferences.lengthMinutes * 60_000);
    if (start.getTime() <= now.getTime()) continue;
    if (overlapsAny(start.getTime(), end.getTime(), taken)) continue;

    proposals.push({ tag, start, end });
  }
  return proposals;
}

/** A title a person would recognise in their calendar. */
export function proposalTitle(tag: Tag, prefix: string): string {
  const name = tag.includes("/") ? (tag.split("/").pop() ?? tag) : tag;
  const label = name.toUpperCase();
  return prefix === "" ? label : `${prefix} ${label}`;
}

/** How pressing a project is: days left, and whether the work still fits in them. */
export interface Pressure {
  tag: Tag;
  deadline: string | null;
  daysLeft: number | null;
  openTasks: number;
  /** Blocks already planned between now and the deadline. */
  plannedBlocks: number;
  /** Tasks those blocks can take; below the open count, the plan is short. */
  plannedCapacity: number;
}

export function pressure(
  tag: Tag,
  plan: PlanDocument,
  openTasks: number,
  capacity: number,
  now: Date
): Pressure {
  const deadline = plan.deadlines[tag]?.date ?? null;
  const perBlock = plan.deadlines[tag]?.capacity ?? capacity;
  const upcoming = plan.blocks.filter(
    (block) =>
      block.tag === tag &&
      Date.parse(block.end) > now.getTime() &&
      (deadline === null || dayKey(new Date(block.start)) <= deadline)
  );

  return {
    tag,
    deadline,
    daysLeft: deadline === null ? null : daysUntil(deadline, now),
    openTasks,
    plannedBlocks: upcoming.length,
    plannedCapacity: upcoming.length * Math.max(1, perBlock)
  };
}

function atMinute(day: Date, minute: number): Date {
  const start = new Date(day);
  start.setHours(0, minute, 0, 0);
  return start;
}

interface Span {
  from: number;
  to: number;
}

function spans(items: readonly Busy[]): Span[] {
  const parsed: Span[] = [];
  for (const item of items) {
    if (item.allDay) continue;
    const from = Date.parse(item.start);
    const to = Date.parse(item.end);
    if (Number.isFinite(from) && Number.isFinite(to)) parsed.push({ from, to });
  }
  return parsed;
}

function overlapsAny(start: number, end: number, taken: readonly Span[]): boolean {
  return taken.some((span) => span.from < end && span.to > start);
}
