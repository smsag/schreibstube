/**
 * Recognising a task again when nothing was written into the note.
 *
 * The plan refers to tasks by an opaque key, and the note has no idea: it
 * holds prose, and prose gets edited. So each key keeps an anchor — the note
 * it was in, the hash of its wording, that wording, and which of the
 * identically worded tasks in the note it was. Matching a new scan against
 * those anchors is a diff, not a guess, which is why it holds up: almost
 * every task is untouched from one pass to the next and matches by hash alone.
 *
 * Where it cannot be sure, it says so rather than choosing. A task rebound to
 * the wrong line would quietly plan the wrong work; a task reported as lost is
 * one line in the planner and one click to put right.
 */
import type { VaultTask } from "./task-inventory";

export interface Anchor {
  path: string;
  hash: string;
  text: string;
  ordinal: number;
}

/** How alike two tasks must read before an edited one is recognised. */
const SAME_NOTE_THRESHOLD = 0.55;
/** Higher across notes: a task that moved has only its wording to vouch for it. */
const OTHER_NOTE_THRESHOLD = 0.75;
/** How far the best candidate must beat the runner-up to count as certain. */
const MARGIN = 0.15;
/** Adjacent lines are likelier to be the same task than distant ones. */
const POSITION_WEIGHT = 0.05;

export interface MatchResult {
  /** Keys that found their task. */
  bound: Map<string, VaultTask>;
  /** Keys whose task could not be found, or could not be told apart. */
  lost: string[];
  /** The anchors as they now stand, ready to be stored again. */
  anchors: Record<string, Anchor>;
}

export function anchorFor(task: VaultTask): Anchor {
  return { path: task.path, hash: task.hash, text: task.text, ordinal: task.ordinal };
}

/**
 * Binds every key to a task in the current scan.
 *
 * Four passes, each only over what the previous one left: the same note and
 * the same position, the same note and the same wording, the same note and
 * similar wording, and finally similar wording anywhere, for a task that was
 * moved to another note.
 */
export function matchAnchors(
  anchors: Record<string, Anchor>,
  tasks: readonly VaultTask[]
): MatchResult {
  const bound = new Map<string, VaultTask>();
  const taken = new Set<VaultTask>();
  const pending = Object.entries(anchors);
  const byPath = new Map<string, VaultTask[]>();
  for (const task of tasks) byPath.set(task.path, [...(byPath.get(task.path) ?? []), task]);

  const bind = (key: string, task: VaultTask): void => {
    bound.set(key, task);
    taken.add(task);
  };
  const free = (candidates: readonly VaultTask[]): VaultTask[] =>
    candidates.filter((task) => !taken.has(task));

  const exact = (anchor: Anchor, sameOrdinal: boolean): VaultTask | undefined =>
    free(byPath.get(anchor.path) ?? []).find(
      (task) => task.hash === anchor.hash && (!sameOrdinal || task.ordinal === anchor.ordinal)
    );

  let rest = pending.filter(([key, anchor]) => {
    const hit = exact(anchor, true);
    if (hit) bind(key, hit);
    return !hit;
  });

  rest = rest.filter(([key, anchor]) => {
    const hit = exact(anchor, false);
    if (hit) bind(key, hit);
    return !hit;
  });

  rest = rest.filter(([key, anchor]) => {
    const hit = nearest(anchor, free(byPath.get(anchor.path) ?? []), SAME_NOTE_THRESHOLD);
    if (hit) bind(key, hit);
    return !hit;
  });

  rest = rest.filter(([key, anchor]) => {
    const hit = nearest(anchor, free(tasks), OTHER_NOTE_THRESHOLD);
    if (hit) bind(key, hit);
    return !hit;
  });

  const updated: Record<string, Anchor> = {};
  for (const [key, task] of bound) updated[key] = anchorFor(task);
  for (const [key, anchor] of rest) updated[key] = anchor;

  return { bound, lost: rest.map(([key]) => key), anchors: updated };
}

/**
 * The one task that clearly reads like the anchor, or nothing.
 *
 * "Clearly" is two conditions: it is similar enough, and it is enough better
 * than the next one. Two near-identical tasks reworded in the same pass fail
 * the second, which is the case that would otherwise go silently wrong.
 */
function nearest(
  anchor: Anchor,
  candidates: readonly VaultTask[],
  threshold: number
): VaultTask | undefined {
  const scored = candidates
    .map((task) => ({ task, score: score(anchor, task) }))
    .sort((left, right) => right.score - left.score);

  const [best, next] = scored;
  if (!best || best.score < threshold) return undefined;
  if (next && best.score - next.score < MARGIN) return undefined;
  return best.task;
}

function score(anchor: Anchor, task: VaultTask): number {
  const nearby =
    anchor.path === task.path && Math.abs(anchor.ordinal - task.ordinal) <= 1 ? POSITION_WEIGHT : 0;
  return Math.min(1, similarity(anchor.text, task.text) + nearby);
}

/**
 * How alike two pieces of text read, from 0 to 1.
 *
 * Dice's coefficient over character trigrams: it rewards shared wording
 * wherever it sits, so a task with a word added at the front still matches,
 * and it costs nothing to compute for the handful of candidates in one note.
 */
export function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function trigrams(text: string): Set<string> {
  const padded = `  ${text.toLowerCase().replace(/\s+/g, " ").trim()}  `;
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= padded.length; index += 1) {
    grams.add(padded.slice(index, index + 3));
  }
  return grams;
}

/** The anchors after a note was renamed; Obsidian tells us, so nothing is guessed. */
export function renamedAnchors(
  anchors: Record<string, Anchor>,
  from: string,
  to: string
): Record<string, Anchor> {
  const moved: Record<string, Anchor> = {};
  for (const [key, anchor] of Object.entries(anchors)) {
    moved[key] = anchor.path === from ? { ...anchor, path: to } : anchor;
  }
  return moved;
}
