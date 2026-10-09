/**
 * Clearing finished tasks out of a note's way: to the back of their list, into
 * an archive at the end of the note, or out of the note altogether.
 *
 * A task is more than its line. Whatever is indented under it — a sub-task, a
 * note typed with Shift+Enter, a code sample — travels with it unchanged, so
 * a task stays a task and a note under it stays a note, wherever it lands.
 *
 * Finished means `[x]`, `[X]` or `[-]`, done or cancelled. The other markers
 * a theme gives meaning to (`[>]`, `[!]`, `[?]`) are not finished, and neither
 * is a ticked task with a sub-task still open: clearing it would take open
 * work with it, so it stays where it is until everything under it is done.
 *
 * The `## Archive` section, wherever it is, is never read for finished tasks.
 * What is in it has already been cleared once.
 */
import { fenceMarker } from "./markdown-fence";
import { taskState } from "./task-state";

export const DONE_TASK_MODES = ["back", "archive", "delete"] as const;
export type DoneTaskMode = (typeof DONE_TASK_MODES)[number];

export const DEFAULT_DONE_TASK_MODE: DoneTaskMode = "back";

export const ARCHIVE_HEADING = "## Archive";

/** The setting as read from `data.json`, which a person can edit by hand. */
export function normalizeDoneTaskMode(value: unknown): DoneTaskMode {
  return DONE_TASK_MODES.find((mode) => mode === value) ?? DEFAULT_DONE_TASK_MODE;
}

export interface DoneTasksResult {
  content: string;
  /** Finished tasks moved, archived or deleted; nested ones travel with their parent and do not count. */
  count: number;
}

const ITEM_PATTERN = /^[ \t]*(?:[-*+]|(\d{1,9})[.)])(?:[ \t]|$)/;
const TASK_PATTERN = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[(.)\](?:[ \t]|$)/;
/** `- - -` and `* * *` are rules, not one-item lists. */
const RULE_PATTERN = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ARCHIVE_PATTERN = /^(#{1,6})[ \t]+archive[ \t]*#*[ \t]*$/i;
const HEADING_PATTERN = /^(#{1,6})[ \t]+\S/;
const finished = (marker: string): boolean => taskState(marker) === "done";

interface Item {
  head: string;
  body: Segment[];
}

interface List {
  items: Item[];
  /** The blank lines after each item but the last, kept by position so a loose list stays loose. */
  gaps: string[][];
  /** The first item's number when the list counts up from it in steps of one, so it can be renumbered. */
  start: number | null;
}

type Segment = { kind: "lines"; lines: string[] } | { kind: "list"; list: List };

/** A tab is four columns, as in Obsidian's own indentation. */
function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

function leadingSpace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/**
 * A note read as lists and the lines between them.
 *
 * Fenced blocks and the frontmatter are opaque: a `- [x]` inside either is
 * text, not a task.
 */
class Reader {
  /** For each line that opens a fence, the line that closes it. */
  private readonly fenceEnd = new Map<number, number>();
  private readonly opaque: boolean[];

  constructor(private readonly lines: readonly string[]) {
    this.opaque = lines.map(() => false);
    let at = 0;
    if (lines[0] === "---") {
      const close = lines.findIndex((line, i) => i > 0 && (line === "---" || line === "..."));
      if (close > 0) {
        for (let i = 0; i <= close; i += 1) this.opaque[i] = true;
        at = close + 1;
      }
    }
    let open: { line: number; fence: string } | null = null;
    for (; at < lines.length; at += 1) {
      const marker = fenceMarker(lines[at] ?? "");
      if (!open) {
        if (marker) open = { line: at, fence: marker };
      } else if (marker && marker[0] === open.fence[0] && marker.length >= open.fence.length) {
        this.close(open.line, at);
        open = null;
      }
    }
    // An unclosed fence runs to the end of the note, as Obsidian reads it.
    if (open) this.close(open.line, lines.length - 1);
  }

  private close(open: number, end: number): void {
    this.fenceEnd.set(open, end);
    for (let i = open; i <= end; i += 1) this.opaque[i] = true;
  }

  isItem(index: number): boolean {
    const line = this.lines[index] ?? "";
    return !this.opaque[index] && ITEM_PATTERN.test(line) && !RULE_PATTERN.test(line);
  }

  isHeading(index: number): boolean {
    return !this.opaque[index] && HEADING_PATTERN.test(this.lines[index] ?? "");
  }

  isArchiveHeading(index: number): boolean {
    return !this.opaque[index] && ARCHIVE_PATTERN.test(this.lines[index] ?? "");
  }

  /** The archive heading's line and the line its section ends before, or null when there is none. */
  archiveSection(): { start: number; end: number } | null {
    const start = this.lines.findIndex((_, i) => this.isArchiveHeading(i));
    if (start === -1) return null;
    const level = ARCHIVE_PATTERN.exec(this.lines[start] ?? "")?.[1]?.length ?? 2;
    for (let i = start + 1; i < this.lines.length; i += 1) {
      const heading = this.isHeading(i) ? HEADING_PATTERN.exec(this.lines[i] ?? "") : null;
      if (heading && (heading[1]?.length ?? 0) <= level) return { start, end: i };
    }
    return { start, end: this.lines.length };
  }

  /** Lines `from` up to `to`, exclusive, as lists and the lines between them. */
  segments(from: number, to: number): Segment[] {
    const segments: Segment[] = [];
    let loose: string[] = [];
    const flush = (): void => {
      if (loose.length > 0) segments.push({ kind: "lines", lines: loose });
      loose = [];
    };

    for (let at = from; at < to;) {
      if (this.isItem(at)) {
        flush();
        const { list, next } = this.list(at, to);
        segments.push({ kind: "list", list });
        at = next;
      } else {
        loose.push(this.lines[at] ?? "");
        at += 1;
      }
    }
    flush();
    return segments;
  }

  /**
   * The list starting at `start`: its items at that indentation, and only
   * blank lines between them. Anything else at that indentation or less ends it.
   */
  private list(start: number, to: number): { list: List; next: number } {
    const indent = indentWidth(this.lines[start] ?? "");
    const items: Item[] = [];
    const gaps: string[][] = [];
    let at = start;

    for (;;) {
      const end = this.blockEnd(at, to);
      items.push({ head: this.lines[at] ?? "", body: this.segments(at + 1, end + 1) });

      let next = end + 1;
      while (next < to && isBlank(this.lines[next] ?? "")) next += 1;
      const sibling =
        next < to && this.isItem(next) && indentWidth(this.lines[next] ?? "") === indent;
      if (!sibling) return { list: { items, gaps, start: countingStart(items) }, next: end + 1 };
      gaps.push(this.lines.slice(end + 1, next));
      at = next;
    }
  }

  /**
   * The last line of the item at `start`: everything indented deeper than its
   * marker, and a fence opened deeper whatever its content's indentation.
   * Blank lines after the last such line belong to whatever follows.
   */
  private blockEnd(start: number, to: number): number {
    const base = indentWidth(this.lines[start] ?? "");
    let end = start;
    for (let at = start + 1; at < to; at += 1) {
      const line = this.lines[at] ?? "";
      const fence = this.fenceEnd.get(at);
      if (fence !== undefined && indentWidth(line) > base) {
        end = Math.min(fence, to - 1);
        at = end;
        continue;
      }
      if (isBlank(line)) continue;
      if (indentWidth(line) <= base) break;
      end = at;
    }
    return end;
  }
}

/** The number an ordered list counts up from, or null when it is not one that does. */
function countingStart(items: readonly Item[]): number | null {
  const numbers = items.map((item) => ITEM_PATTERN.exec(item.head)?.[1]);
  const first = Number(numbers[0]);
  if (numbers[0] === undefined) return null;
  return numbers.every((n, i) => n !== undefined && Number(n) === first + i) ? first : null;
}

function marker(item: Item): string | null {
  return TASK_PATTERN.exec(item.head)?.[1] ?? null;
}

/** Whether anything under the item is a task that is not finished. */
function hasUnfinished(segments: readonly Segment[]): boolean {
  return segments.some(
    (segment) =>
      segment.kind === "list" &&
      segment.list.items.some((item) => {
        const state = marker(item);
        return (state !== null && !finished(state)) || hasUnfinished(item.body);
      })
  );
}

function isFinished(item: Item): boolean {
  const state = marker(item);
  return state !== null && finished(state) && !hasUnfinished(item.body);
}

function renderSegments(segments: readonly Segment[]): string[] {
  return segments.flatMap((segment) =>
    segment.kind === "lines" ? segment.lines : renderList(segment.list)
  );
}

function renderList(list: List): string[] {
  return list.items.flatMap((item, i) => [
    ...(i > 0 ? (list.gaps[i - 1] ?? []) : []),
    ...renderItem(item, list.start === null ? null : list.start + i)
  ]);
}

function renderItem(item: Item, number: number | null): string[] {
  const head =
    number === null ? item.head : item.head.replace(/^([ \t]*)\d+(?=[.)])/, `$1${number}`);
  return [head, ...renderSegments(item.body)];
}

/** Finished tasks after the rest of their list, in their order; sub-lists of the rest likewise. */
function sendBack(segments: readonly Segment[]): number {
  let moved = 0;
  for (const segment of segments) {
    if (segment.kind !== "list") continue;
    const { list } = segment;
    const stay = list.items.filter((item) => !isFinished(item));
    const go = list.items.filter(isFinished);
    // Only the finished tasks with something left to pass actually move.
    const lastStay = list.items.map(isFinished).lastIndexOf(false);
    moved += list.items.filter((item, i) => i < lastStay && isFinished(item)).length;
    list.items = [...stay, ...go];
    for (const item of stay) moved += sendBack(item.body);
  }
  return moved;
}

/** Where a run of segments sits, which decides what happens to the blank lines a removal leaves. */
type Place = "top" | "rest" | "body";

/**
 * Takes finished tasks out of their lists. `deep` reaches into the
 * sub-lists of what stays; otherwise only the outermost lists are read, and a
 * finished sub-task stays with its open parent. Returns what was taken out,
 * in document order.
 */
function takeFinished(segments: Segment[], deep: boolean, place: Place): Item[] {
  const taken: Item[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment?.kind !== "list") continue;
    const { list } = segment;
    taken.push(...list.items.filter(isFinished));
    list.items = list.items.filter((item) => !isFinished(item));
    list.gaps = list.gaps.slice(0, Math.max(0, list.items.length - 1));
    if (deep) for (const item of list.items) taken.push(...takeFinished(item.body, true, "body"));
    if (list.items.length === 0) {
      segments.splice(i, 1);
      closeGap(segments, i, place === "top");
      i -= 1;
    }
  }
  if (place === "body") trimTrailingBlanks(segments);
  return taken;
}

/**
 * A list taken out between two blank lines leaves two in a row, one too many.
 * At the very top of the note, where nothing came before, the blank lines
 * after it are one too many as well.
 */
function closeGap(segments: Segment[], at: number, atStart: boolean): void {
  const before = segments[at - 1];
  const after = segments[at];
  if (after?.kind !== "lines") return;
  const blankBefore =
    before === undefined ? atStart : before.kind === "lines" && isBlank(before.lines.at(-1) ?? "x");
  if (!blankBefore) return;
  while (after.lines.length > 0 && isBlank(after.lines[0] ?? "")) after.lines.shift();
  if (after.lines.length === 0) segments.splice(at, 1);
}

/** An item's body ends with its last line of content; the blank lines after it are the list's. */
function trimTrailingBlanks(segments: Segment[]): void {
  const last = segments.at(-1);
  if (last?.kind !== "lines") return;
  while (last.lines.length > 0 && isBlank(last.lines.at(-1) ?? "")) last.lines.pop();
  if (last.lines.length === 0) segments.pop();
}

/**
 * An item's lines as an entry of the archive list: at that list's
 * indentation, and with its marker, so a numbered task filed under bullets
 * does not start a list of its own. The task's own text and everything under
 * it are kept as they were.
 */
function forArchive(item: Item, indent: string, bullet: string): string[] {
  const from = leadingSpace(item.head);
  const [head = "", ...body] = renderItem(item, null).map((line) =>
    line.startsWith(from) && !isBlank(line) ? indent + line.slice(from.length) : line
  );
  return [head.replace(/^([ \t]*)(?:[-*+]|\d{1,9}[.)])/, `$1${bullet}`), ...body];
}

/** The marker an archive list's entries take: its first item's, a numbered list's counting from 1. */
function bulletOf(head: string): string {
  const marker = /^[ \t]*([-*+]|\d{1,9}([.)]))/.exec(head);
  if (!marker) return "-";
  return marker[2] ? `1${marker[2]}` : (marker[1] ?? "-");
}

function asItem(lines: readonly string[]): Item {
  return { head: lines[0] ?? "", body: [{ kind: "lines", lines: lines.slice(1) }] };
}

/** The archive's lines with `items` added at the end of its last list, or a new one. */
function fileInArchive(
  reader: Reader,
  lines: readonly string[],
  section: { start: number; end: number },
  items: readonly Item[]
): string[] {
  const { start, end } = section;
  const segments = reader.segments(start + 1, end);
  const lists = segments.flatMap((segment) => (segment.kind === "list" ? [segment.list] : []));
  const list = lists[lists.length - 1];

  if (list) {
    const first = list.items[0]?.head ?? "";
    const gap = list.gaps.some((g) => g.length > 0) ? [""] : [];
    for (const item of items) {
      list.gaps.push(gap);
      list.items.push(asItem(forArchive(item, leadingSpace(first), bulletOf(first))));
    }
    return [lines[start] ?? "", ...renderSegments(segments)];
  }

  // No list yet: one after the section's last line of content, set off by a
  // blank line, and from a heading that follows by another.
  const own = lines.slice(start, end);
  let last = own.length;
  while (last > 1 && isBlank(own[last - 1] ?? "")) last -= 1;
  const after = own.slice(last);
  return [
    ...own.slice(0, last),
    "",
    ...items.flatMap((item) => forArchive(item, "", "-")),
    ...(after.length === 0 && end < lines.length ? [""] : after)
  ];
}

/**
 * Finished tasks cleared out of the note the given way. The content comes
 * back unchanged, with a count of nought, when there is nothing to clear.
 */
export function clearDoneTasks(content: string, mode: DoneTaskMode): DoneTasksResult {
  const lines = content.split("\n");
  const reader = new Reader(lines);
  const archive = reader.archiveSection();
  const head = reader.segments(0, archive?.start ?? lines.length);
  const tail = archive ? reader.segments(archive.end, lines.length) : [];
  const section = archive ? lines.slice(archive.start, archive.end) : [];

  let count: number;
  let filed = section;
  if (mode === "back") {
    count = sendBack(head) + sendBack(tail);
  } else if (mode === "delete") {
    count = takeFinished(head, true, "top").length + takeFinished(tail, true, "rest").length;
  } else {
    const taken = [...takeFinished(head, false, "top"), ...takeFinished(tail, false, "rest")];
    count = taken.length;
    if (taken.length > 0) {
      filed = archive
        ? fileInArchive(reader, lines, archive, taken)
        : [ARCHIVE_HEADING, "", ...taken.flatMap((item) => forArchive(item, "", "-"))];
    }
  }
  if (count === 0) return { content, count: 0 };

  if (archive) {
    return {
      content: [...renderSegments(head), ...filed, ...renderSegments(tail)].join("\n"),
      count
    };
  }
  const body = renderSegments(head);
  if (mode !== "archive") return { content: body.join("\n"), count };

  // A new archive goes at the very end, after one blank line, and the note
  // keeps the final newline it had.
  while (body.length > 0 && isBlank(body.at(-1) ?? "")) body.pop();
  const before = body.length > 0 ? [...body, ""] : [];
  const close = content.endsWith("\n") ? [""] : [];
  return { content: [...before, ...filed, ...close].join("\n"), count };
}
