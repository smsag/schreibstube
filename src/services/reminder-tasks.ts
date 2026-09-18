/**
 * Which tasks in a note are reminders, and what each one says.
 *
 * A task is a reminder because of what it carries, not because a command was
 * run on it: a due date in the Tasks plugin's form, `📅 2026-09-20`, or the
 * tag `#remind`. The note declares; the sync makes Reminders agree. Editing
 * the date or the text, ticking the box or deleting the line is all the
 * interface there is.
 *
 * Each such task gets an Obsidian block id at the end of its line, `^r-k3x9a2`.
 * That id names the reminder in both directions: it is in the link the
 * reminder carries back to the note, and it is how the sync tells one task
 * from another whatever the note is called by then. A block id is Obsidian's
 * own anchor, hidden in Reading view, so the line stays readable anywhere.
 *
 * Everything here is text in, text out.
 */
import { taskBodyRange } from "./task-fold";
import { taskMarker } from "./task-summary";

/** The `obsidian://schreibstube` action the plugin answers to. */
export const TASK_PROTOCOL_ACTION = "schreibstube";

/** The tag that makes any task a reminder, dated or not. */
export const REMIND_TAG = "#remind";

/** What makes a task a reminder: a due date or the tag, or the tag alone. */
export type ReminderTrigger = "date" | "tag";

/** Reminders shows a title on one line; past this it is a note, not a title. */
export const MAX_REMINDER_TITLE_CHARS = 200;

/** A reminder's note is for context, not the whole section; the outbox stays small. */
export const MAX_REMINDER_NOTES_CHARS = 2000;

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const BLOCK_ID_PATTERN = /\s\^([A-Za-z0-9-]{1,64})\s*$/;
/** The link 1.29 to 1.35 put at the end of a sent task, read once to migrate it. */
const LEGACY_LINK_PATTERN =
  /\s*\[[^\]]*\]\(obsidian:\/\/schreibstube\?task=([A-Za-z0-9-]{1,64})\)\s*$/;
const TASK_PREFIX_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?/;
const BOX_PATTERN = /^(\s*(?:[-*+]|\d+[.)])\s+\[).\]/;
const DUE_PATTERN = /📅\s*(\d{4}-\d{2}-\d{2})/u;
/** The Tasks plugin's dated fields; all of them are metadata, not the title. */
const TASKS_DATES_PATTERN = /\s*(?:📅|⏳|🛫|✅|➕|❌)\s*\d{4}-\d{2}-\d{2}/gu;
const REMIND_TAG_PATTERN = /(^|\s)#remind(?=\s|$)/;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 6;
const ID_PREFIX = "r-";

/** The URL that brings a person from the reminder back to the task. */
export function taskLink(id: string): string {
  return `obsidian://${TASK_PROTOCOL_ACTION}?task=${encodeURIComponent(id)}&from=reminders`;
}

/**
 * The text a reminder's notes contain exactly when they belong to `id`.
 *
 * `task=abc` alone would also match the notes of `abcd`; the parameter after
 * it closes the id off, so a plain "contains" in a Shortcut is exact.
 */
export function taskMatch(id: string): string {
  return `task=${id}&`;
}

/** A fresh id, `r-` and six lowercase characters. */
export function generateTaskId(random: () => number = Math.random): string {
  let id = ID_PREFIX;
  for (let index = 0; index < ID_LENGTH; index += 1) {
    const at = Math.min(ID_ALPHABET.length - 1, Math.floor(random() * ID_ALPHABET.length));
    id += ID_ALPHABET[at];
  }
  return id;
}

/** The block id at the end of a line, if it has one. */
export function blockIdOf(line: string): string | null {
  return BLOCK_ID_PATTERN.exec(line)?.[1] ?? null;
}

/** The task's due date, `YYYY-MM-DD`, if it has one. */
export function dueOf(line: string): string | null {
  return DUE_PATTERN.exec(line)?.[1] ?? null;
}

/** Whether a line is a task at all. */
export function isTaskLine(line: string): boolean {
  return taskMarker(line) !== null;
}

/** Whether a task is done: anything in the box but a space, so a cancelled task counts too. */
export function isDone(line: string): boolean {
  const marker = taskMarker(line);
  return marker !== null && marker !== " ";
}

/** Whether a task line is one the sync keeps in Reminders. */
export function isReminderTask(line: string, trigger: ReminderTrigger): boolean {
  if (!isTaskLine(line)) return false;
  if (REMIND_TAG_PATTERN.test(line) || LEGACY_LINK_PATTERN.test(line)) return true;
  return trigger === "date" && dueOf(line) !== null;
}

/** The task's text without marker, box, dates, the remind tag and the id. Other tags stay. */
export function taskTitle(line: string): string {
  const text = line
    .replace(TASK_PREFIX_PATTERN, "")
    .replace(LEGACY_LINK_PATTERN, "")
    .replace(BLOCK_ID_PATTERN, "")
    .replace(TASKS_DATES_PATTERN, "")
    .replace(REMIND_TAG_PATTERN, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_REMINDER_TITLE_CHARS
    ? `${text.slice(0, MAX_REMINDER_TITLE_CHARS - 1)}…`
    : text;
}

/** The line with its box set to done or open. A done box keeps whatever marker it had. */
export function withDone(line: string, done: boolean): string {
  if (isDone(line) === done) return line;
  return line.replace(BOX_PATTERN, `$1${done ? "x" : " "}]`);
}

/** The line with the remind tag added before its id, unless it already qualifies by it. */
export function withRemindTag(line: string): string {
  if (REMIND_TAG_PATTERN.test(line)) return line;
  const id = blockIdOf(line);
  const bare = id ? line.replace(BLOCK_ID_PATTERN, "") : line.replace(/\s+$/, "");
  return id ? `${bare} ${REMIND_TAG} ^${id}` : `${bare} ${REMIND_TAG}`;
}

/**
 * Gives every reminder task in a note an id, and turns the link earlier
 * versions put at the end of a sent task into the tag and a block id with the
 * same id, so the reminders made back then still open the note.
 *
 * Returns null when nothing changed, so a caller writes only what moved.
 * `taken` is every id already in use; ids handed out are added to it.
 */
export function withTaskIds(
  content: string,
  trigger: ReminderTrigger,
  taken: Set<string>,
  nextId: () => string = generateTaskId
): string | null {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  let changed = false;

  const lines = content.split(/\r?\n/).map((line) => {
    const legacy = LEGACY_LINK_PATTERN.exec(line)?.[1];
    if (legacy && isTaskLine(line)) {
      changed = true;
      taken.add(legacy);
      return `${withRemindTag(line.replace(LEGACY_LINK_PATTERN, ""))} ^${legacy}`;
    }
    if (!isReminderTask(line, trigger) || blockIdOf(line)) return line;

    let id = nextId();
    for (let attempt = 0; taken.has(id) && attempt < 20; attempt += 1) id = nextId();
    taken.add(id);
    changed = true;
    return `${line.replace(/\s+$/, "")} ^${id}`;
  });

  return changed ? lines.join(newline) : null;
}

/** Every block id in a note, for the set of ids already taken. */
export function blockIdsIn(content: string): string[] {
  const ids: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const id = blockIdOf(line);
    if (id) ids.push(id);
  }
  return ids;
}

/** A task as the note says it should be in Reminders. */
export interface NoteTask {
  id: string;
  path: string;
  /** Zero-based line of the task in its note. */
  line: number;
  title: string;
  notes: string;
  due: string | null;
  done: boolean;
}

/** Every reminder task in a note that already carries an id. */
export function reminderTasksIn(
  path: string,
  noteTitle: string,
  content: string,
  trigger: ReminderTrigger
): NoteTask[] {
  const lines = content.split(/\r?\n/);
  const tasks: NoteTask[] = [];

  for (const [index, line] of lines.entries()) {
    if (!isReminderTask(line, trigger)) continue;
    const id = blockIdOf(line);
    if (!id) continue;
    tasks.push({
      id,
      path,
      line: index,
      title: taskTitle(line),
      notes: reminderNotes(taskBody(lines, index), noteTitle, id),
      due: dueOf(line),
      done: isDone(line)
    });
  }
  return tasks;
}

/**
 * The text indented under the task, with the shared indentation removed so
 * it reads as prose in a note field rather than as a code block.
 */
export function taskBody(lines: readonly string[], taskLine: number): string {
  const range = taskBodyRange(lines, taskLine);
  if (!range) return "";

  const body = lines.slice(range.start, range.end + 1);
  const indents = body.filter((line) => line.trim() !== "").map((line) => leadingWhitespace(line));
  const common = indents.reduce(
    (shortest, indent) => commonPrefix(shortest, indent),
    indents[0] ?? ""
  );

  return body
    .map((line) => (line.startsWith(common) ? line.slice(common.length) : line.trimStart()))
    .join("\n")
    .trim();
}

function leadingWhitespace(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? "";
}

function commonPrefix(a: string, b: string): string {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return a.slice(0, length);
}

/** Body, then a cue line with the note's title, then the link back. */
export function reminderNotes(body: string, noteTitle: string, id: string): string {
  const trail = `↩ ${noteTitle}\n${taskLink(id)}`;
  const room = MAX_REMINDER_NOTES_CHARS - trail.length - 2;
  const clipped = body.length > room ? `${body.slice(0, Math.max(0, room - 1))}…` : body;
  return clipped ? `${clipped}\n\n${trail}` : trail;
}

/** The line that carries `id`, as a block id or as the link of earlier versions. */
export function findTaskLine(content: string, id: string): number | null {
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (blockIdOf(line) === id || LEGACY_LINK_PATTERN.exec(line)?.[1] === id) return index;
  }
  return null;
}

/** The task id in an `obsidian://schreibstube?task=…` call, if it is one. */
export function taskIdFromParams(params: Record<string, string>): string | null {
  const id = params.task ?? "";
  return ID_PATTERN.test(id) ? id : null;
}

/** Where a reminder task's id sits in its line, for a renderer that replaces it. */
export function reminderIdSpan(
  line: string,
  trigger: ReminderTrigger
): { from: number; to: number } | null {
  if (!isReminderTask(line, trigger)) return null;
  const match = BLOCK_ID_PATTERN.exec(line);
  if (!match) return null;
  const from = match.index + 1;
  return { from, to: from + match[0].trim().length };
}
