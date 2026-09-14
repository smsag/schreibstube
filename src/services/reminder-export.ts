/**
 * A task on its way to Apple's Reminders, and the way back.
 *
 * Obsidian cannot reach Reminders itself. What it can do is open a Shortcut by
 * URL and hand it text, and a Shortcut can create a reminder. So a task is
 * reduced to a small JSON document — title, notes, list, and a link back —
 * and the Shortcut does the rest. The link back is an Obsidian URL carrying a
 * block id, which the plugin resolves to the note and the line whatever the
 * note is called by then.
 *
 * Everything here is text in, text out, so it can be tested without either
 * application present.
 */
import { taskBodyRange } from "./task-fold";
import { taskMarker } from "./task-summary";

/** Reminders shows a title on one line; past this it is a note, not a title. */
export const MAX_REMINDER_TITLE_CHARS = 200;

/** The whole payload travels inside a URL, and a URL has to stay a URL. */
export const MAX_REMINDER_NOTES_CHARS = 2000;

/** The `obsidian://schreibstube` action the plugin answers to. */
export const TASK_PROTOCOL_ACTION = "schreibstube";

const BLOCK_ID_PATTERN = /\s\^([A-Za-z0-9-]+)\s*$/;
const TASK_PREFIX_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?/;
const BLOCK_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const BLOCK_ID_LENGTH = 6;
const TASK_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** The block id already on a line, if someone or something put one there. */
export function blockIdOf(line: string): string | null {
  return BLOCK_ID_PATTERN.exec(line)?.[1] ?? null;
}

/** The line with `id` as its block id, replacing one it already had. */
export function withBlockId(line: string, id: string): string {
  const bare = line.replace(BLOCK_ID_PATTERN, "").replace(/\s+$/, "");
  return `${bare} ^${id}`;
}

/** Six lowercase characters, the shape Obsidian gives its own block ids. */
export function generateBlockId(random: () => number = Math.random): string {
  let id = "";
  for (let index = 0; index < BLOCK_ID_LENGTH; index += 1) {
    const at = Math.min(
      BLOCK_ID_ALPHABET.length - 1,
      Math.floor(random() * BLOCK_ID_ALPHABET.length)
    );
    id += BLOCK_ID_ALPHABET[at];
  }
  return id;
}

/** The task's text without its list marker, checkbox and block id. Tags stay. */
export function taskTitle(line: string): string {
  const text = line.replace(TASK_PREFIX_PATTERN, "").replace(BLOCK_ID_PATTERN, "").trim();
  return text.length > MAX_REMINDER_TITLE_CHARS
    ? `${text.slice(0, MAX_REMINDER_TITLE_CHARS - 1)}…`
    : text;
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
  const common = indents.reduce((shortest, indent) => commonPrefix(shortest, indent));

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

/** The URL that brings a person from the reminder back to the task. */
export function taskLink(id: string): string {
  return `obsidian://${TASK_PROTOCOL_ACTION}?task=${encodeURIComponent(id)}`;
}

export interface ReminderPayload {
  title: string;
  /** Body, then a cue line with the note's title, then the link. */
  notes: string;
  /** Reminders list to create in; empty leaves the choice to the Shortcut. */
  list: string;
  link: string;
  /** The note's title on its own, for a Shortcut that wants to place it. */
  note: string;
}

export interface ReminderInput {
  lines: readonly string[];
  taskLine: number;
  id: string;
  list: string;
  noteTitle: string;
}

export function buildReminder({
  lines,
  taskLine,
  id,
  list,
  noteTitle
}: ReminderInput): ReminderPayload {
  const link = taskLink(id);
  const body = taskBody(lines, taskLine);
  const trail = `↩ ${noteTitle}\n${link}`;
  const room = MAX_REMINDER_NOTES_CHARS - trail.length - 2;
  const clipped = body.length > room ? `${body.slice(0, Math.max(0, room - 1))}…` : body;

  return {
    title: taskTitle(lines[taskLine] ?? ""),
    notes: clipped ? `${clipped}\n\n${trail}` : trail,
    list,
    link,
    note: noteTitle
  };
}

/** The URL that runs the Shortcut with the payload as its text input. */
export function shortcutUrl(shortcut: string, payload: ReminderPayload): string {
  const name = encodeURIComponent(shortcut.trim());
  const text = encodeURIComponent(JSON.stringify(payload));
  return `shortcuts://run-shortcut?name=${name}&input=text&text=${text}`;
}

/** The task id in an `obsidian://schreibstube?task=…` call, if it is one. */
export function taskIdFromParams(params: Record<string, string>): string | null {
  const id = params.task ?? "";
  return TASK_ID_PATTERN.test(id) ? id : null;
}

/** Whether a line is a task at all; the command and menu hide otherwise. */
export function isTaskLine(line: string): boolean {
  return taskMarker(line) !== null;
}
