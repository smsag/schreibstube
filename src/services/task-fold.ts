/**
 * What a ticked task folds away, and when.
 *
 * A task can carry more than its first line: an indented paragraph typed with
 * Shift+Enter, a note under it, sub-items. While the task is open that text is
 * the work; once it is ticked it is history, and it collapses so the list
 * reads as a list again. Untick, and it comes back.
 *
 * The rules here are pure so they can be tested against text. The editor
 * extension maps them onto CodeMirror folds; the reading-view processor maps
 * them onto rendered HTML.
 */
import type { TaskLine } from "./task-summary";

export interface FoldTransitions {
  /** Tasks whose body should fold: just ticked, or done when first seen. */
  fold: number[];
  /** Tasks whose body should unfold: just unticked. */
  unfold: number[];
}

/**
 * Which tasks changed state between two versions of a note.
 *
 * `before` is keyed by the line each old task occupies in the new document,
 * so a task is followed through the edit rather than matched by position. A
 * task with no counterpart is new to the document — pasted in, or the whole
 * note just loaded — and folds if it arrives done, which is what "already
 * ticked tasks are collapsed when the note opens" means in practice. A fold
 * or unfold happens only on a change of state: someone who opened a done task
 * by hand keeps it open through every keystroke elsewhere.
 */
export function foldTransitions(
  before: ReadonlyMap<number, boolean>,
  after: readonly TaskLine[]
): FoldTransitions {
  const fold: number[] = [];
  const unfold: number[] = [];

  for (const task of after) {
    const wasOpen = before.get(task.line);
    if (wasOpen === undefined) {
      if (!task.open) fold.push(task.line);
    } else if (wasOpen && !task.open) {
      fold.push(task.line);
    } else if (!wasOpen && task.open) {
      unfold.push(task.line);
    }
  }

  return { fold, unfold };
}

export interface LineRange {
  /** Zero-based, inclusive. */
  start: number;
  end: number;
}

/** A tab is four columns, which is what Obsidian's own indentation assumes. */
function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

/**
 * The lines that belong to a task below its first line: everything indented
 * deeper than the task's own marker, up to the first line that is not.
 * Blank lines inside the body are part of it; blank lines after it are not,
 * so folding a task never swallows the gap before the next paragraph.
 */
export function taskBodyRange(lines: readonly string[], taskLine: number): LineRange | null {
  const base = indentWidth(lines[taskLine] ?? "");
  let end = taskLine;

  for (let index = taskLine + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    if (indentWidth(line) <= base) break;
    end = index;
  }

  return end > taskLine ? { start: taskLine + 1, end } : null;
}

/** Elements that start a new line of their own in a rendered list item. */
const BLOCK_TAGS = new Set([
  "P",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "DIV",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6"
]);

/**
 * Where a rendered task's body begins among its child nodes.
 *
 * Each entry is a child node reduced to what matters: an element's tag name,
 * `null` for text, and `""` for whitespace-only text, which the renderer
 * leaves between elements and which is nobody's first line. The checkbox
 * itself is skipped. The first line is the first run of text and inline
 * elements up to a line break, or the first block element; the body is
 * everything from the break or the second block onwards. Returns -1 when the
 * item has no body.
 */
export function bodyStartIndex(tags: readonly (string | null)[]): number {
  let headSeen = false;

  for (const [index, tag] of tags.entries()) {
    if (tag === "" || tag === "INPUT") continue;
    if (tag === "BR") return index;
    if (tag !== null && BLOCK_TAGS.has(tag)) {
      if (headSeen) return index;
      headSeen = true;
      continue;
    }
    headSeen = true;
  }

  return -1;
}
