/**
 * The vault's tasks, as the planner sees them.
 *
 * Planning writes nothing into a note. A task is its text, the tags it
 * carries and whether its box is ticked; a date is allowed but never required,
 * because a task belongs to a time block, not to a clock. Everything the plan
 * needs to recognise that task again later is derived here and kept outside
 * the note, in the plan document.
 *
 * Text in, plain objects out.
 */
import { taskMarker } from "./task-summary";

/** A tag with its full path, `projects/ea48`, without the hash. */
export type Tag = string;

export interface VaultTask {
  path: string;
  /** Zero-based line in its note. */
  line: number;
  /** The task as a person reads it: no marker, no box, no date marker. */
  text: string;
  /** Of the normalised text, for recognising an unchanged task instantly. */
  hash: string;
  /** Which of the identically worded tasks in this note this one is. */
  ordinal: number;
  tags: Tag[];
  /** A real deadline the task carries itself, `YYYY-MM-DD`, or null. */
  due: string | null;
  done: boolean;
}

const TASK_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?/;
const BLOCK_ID = /\s\^[A-Za-z0-9-]{1,64}\s*$/;
const DUE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const DATED_FIELDS = /\s*(?:📅|⏳|🛫|✅|➕|❌)\s*\d{4}-\d{2}-\d{2}/gu;
const TAG = /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9/_-]*)/g;

/** Longest text kept for a task; a paragraph in a checkbox is not a task. */
export const MAX_TASK_TEXT = 500;

/** Every task in a note, with what the planner needs to tell them apart. */
export function tasksInNote(path: string, content: string): VaultTask[] {
  const tasks: VaultTask[] = [];
  const seen = new Map<string, number>();

  for (const [line, raw] of content.split(/\r?\n/).entries()) {
    const marker = taskMarker(raw);
    if (marker === null) continue;

    const text = taskText(raw);
    const hash = taskHash(text);
    const ordinal = seen.get(hash) ?? 0;
    seen.set(hash, ordinal + 1);

    tasks.push({
      path,
      line,
      text,
      hash,
      ordinal,
      tags: tagsIn(raw),
      due: DUE.exec(raw)?.[1] ?? null,
      done: marker !== " "
    });
  }
  return tasks;
}

/** The task's own words: no marker, no box, no dates, no block id. Tags stay. */
export function taskText(line: string): string {
  const text = line
    .replace(TASK_PREFIX, "")
    .replace(BLOCK_ID, "")
    .replace(DATED_FIELDS, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_TASK_TEXT ? `${text.slice(0, MAX_TASK_TEXT - 1)}…` : text;
}

/** The tags a task carries, in order, once each. */
export function tagsIn(line: string): Tag[] {
  const tags: Tag[] = [];
  for (const match of taskText(line).matchAll(TAG)) {
    const tag = match[1];
    if (tag !== undefined && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * A short hash of the task's wording, ignoring case and spacing.
 *
 * FNV-1a: not a security property, just a cheap and stable way to say "this
 * is the same sentence as last time", which is the common case on every pass.
 */
export function taskHash(text: string): string {
  const normalised = text.toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalised.length; index += 1) {
    hash ^= normalised.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Whether a task carries `tag` itself or a tag nested under it. */
export function hasTag(task: VaultTask, tag: Tag): boolean {
  return task.tags.some((carried) => carried === tag || carried.startsWith(`${tag}/`));
}

/** The open tasks for a tag: deadline first, then the order they were written. */
export function tasksForTag(tasks: readonly VaultTask[], tag: Tag): VaultTask[] {
  return tasks
    .filter((task) => !task.done && hasTag(task, tag))
    .sort((left, right) => compareDue(left.due, right.due));
}

function compareDue(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}

/**
 * The project tags in the vault, with how many tasks are open under each.
 *
 * A prefix keeps the planner's list to the tags meant for it: `projects`
 * yields `projects/ea48`, never `lektorat`. An empty prefix means every tag
 * is a candidate, for a vault that does not nest them.
 */
export function projectTags(
  tasks: readonly VaultTask[],
  prefix: string
): { tag: Tag; open: number; total: number }[] {
  const counts = new Map<Tag, { open: number; total: number }>();

  for (const task of tasks) {
    for (const tag of task.tags) {
      if (prefix !== "" && tag !== prefix && !tag.startsWith(`${prefix}/`)) continue;
      if (tag === prefix) continue;
      const count = counts.get(tag) ?? { open: 0, total: 0 };
      count.total += 1;
      if (!task.done) count.open += 1;
      counts.set(tag, count);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, ...count }))
    .sort((left, right) => right.open - left.open || left.tag.localeCompare(right.tag));
}
