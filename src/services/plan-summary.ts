/**
 * The plan reduced to what a start page shows.
 *
 * A start page is read at a glance: the block you are in or heading for, what
 * belongs to it, and which projects are running out of days. Everything a
 * renderer would otherwise decide in the middle of building DOM — which block
 * counts as current, what "in 5 days" means, whether a project's planned time
 * covers its open work — is settled here, where a test can check it.
 */
import {
  blocksOn,
  currentBlock,
  dayKey,
  daysUntil,
  type PlanBlock,
  type PlanDocument,
  type PlanMember
} from "./plan-model";
import { hasTag, type Tag, type VaultTask } from "./task-inventory";

export const PLAN_BLOCK_LANGUAGE = "schreibstube-plan";

export interface PlanBlockOptions {
  /** `today`, or a date the block was written for. */
  day: string | "today";
  /** Restrict to these project tags; empty means all of them. */
  tags: Tag[];
  show: "blocks" | "deadlines" | "both";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The block's own options, one `key: value` per line.
 *
 * Unknown keys are ignored rather than refused: a start page is edited by
 * hand, and a typo should cost the line, not the panel.
 */
export function parsePlanOptions(source: string): PlanBlockOptions {
  const options: PlanBlockOptions = { day: "today", tags: [], show: "both" };

  for (const line of source.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!key || value === "") continue;

    if (key === "day" && (value === "today" || DAY.test(value))) options.day = value;
    if (key === "tags") {
      options.tags = value
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter((tag) => tag !== "");
    }
    if (key === "show" && (value === "blocks" || value === "deadlines" || value === "both")) {
      options.show = value;
    }
  }
  return options;
}

export interface SummaryTask {
  key: string;
  text: string;
  path: string;
  done: boolean;
  remind: boolean;
  /** The plan refers to it but the vault no longer shows it. */
  lost: boolean;
}

export interface SummaryBlock {
  uid: string;
  tag: Tag;
  title: string;
  start: string;
  end: string;
  /** Running right now. */
  live: boolean;
  tasks: SummaryTask[];
  open: number;
}

export interface SummaryDeadline {
  tag: Tag;
  date: string;
  daysLeft: number;
  openTasks: number;
  plannedTasks: number;
}

export interface PlanSummary {
  day: string;
  blocks: SummaryBlock[];
  /** The one to lead with: running now, or next. */
  current: SummaryBlock | null;
  deadlines: SummaryDeadline[];
}

export interface SummaryInput {
  plan: PlanDocument;
  tasks: readonly VaultTask[];
  lost: readonly string[];
  options: PlanBlockOptions;
  now: Date;
}

export function summarize({ plan, tasks, lost, options, now }: SummaryInput): PlanSummary {
  const day = options.day === "today" ? dayKey(now) : options.day;
  const wanted = (tag: Tag) =>
    options.tags.length === 0 ||
    options.tags.some((one) => tag === one || tag.startsWith(`${one}/`));

  const blocks = blocksOn(plan, day)
    .filter((block) => wanted(block.tag))
    .map((block) => toSummary(block, lost, now));

  const currentUid = currentBlock(plan, now)?.uid;
  const current =
    blocks.find((block) => block.uid === currentUid) ??
    (day === dayKey(now) ? (blocks.find((block) => block.open > 0) ?? blocks[0] ?? null) : null);

  const deadlines = Object.entries(plan.deadlines)
    .filter(([tag]) => wanted(tag))
    .map(([tag, deadline]) => ({
      tag,
      date: deadline.date,
      daysLeft: daysUntil(deadline.date, now),
      openTasks: tasks.filter((task) => !task.done && hasTag(task, tag)).length,
      plannedTasks: plannedFor(plan, tag, now)
    }))
    .sort((left, right) => left.daysLeft - right.daysLeft || left.tag.localeCompare(right.tag));

  return { day, blocks, current, deadlines };
}

function toSummary(block: PlanBlock, lost: readonly string[], now: Date): SummaryBlock {
  const tasks = block.members.map((member) => toTask(member, lost));
  return {
    uid: block.uid,
    tag: block.tag,
    title: block.title,
    start: block.start,
    end: block.end,
    live: Date.parse(block.start) <= now.getTime() && Date.parse(block.end) > now.getTime(),
    tasks,
    open: tasks.filter((task) => !task.done).length
  };
}

function toTask(member: PlanMember, lost: readonly string[]): SummaryTask {
  return {
    key: member.key,
    text: member.text,
    path: member.path,
    done: member.done === true,
    remind: member.remind,
    lost: lost.includes(member.key)
  };
}

/** Tasks already placed in blocks for a project, from now until its deadline. */
function plannedFor(plan: PlanDocument, tag: Tag, now: Date): number {
  return plan.blocks
    .filter((block) => block.tag === tag && Date.parse(block.end) > now.getTime())
    .reduce((count, block) => count + block.members.filter((one) => one.done !== true).length, 0);
}

/** `05:30–06:00`, in the reader's own locale. */
export function timeRange(start: string, end: string, locale: string): string {
  const format = (value: string) =>
    new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${format(start)}–${format(end)}`;
}
