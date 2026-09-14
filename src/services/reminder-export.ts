/**
 * A task on its way to Apple's Reminders, and the way back.
 *
 * Obsidian cannot reach Reminders itself. What it can do is open a Shortcut by
 * URL and hand it text, and a Shortcut can create a reminder. So a task is
 * reduced to a small JSON document — title, notes, list, and a link back —
 * and the Shortcut does the rest.
 *
 * The link back is an Obsidian URL carrying an id. The same link is written
 * into the task line itself, as a Markdown link at its end, so the note shows
 * that the task was sent and the id has a home the plugin can find again
 * whatever the note is called by then. Obsidian renders that link as a small
 * Reminders-style mark; anywhere else it is the clock the link text carries.
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

/** What the link says where the plugin is not there to draw the mark. */
export const REMINDER_LINK_TEXT = "⏰";

const TASK_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const REMINDER_LINK_PATTERN =
  /\s*\[([^\]]*)\]\(obsidian:\/\/schreibstube\?task=([A-Za-z0-9-]{1,64})\)\s*$/;
const TASK_PREFIX_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?/;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 6;

/** The URL that brings a person from the reminder back to the task. */
export function taskLink(id: string): string {
  return `obsidian://${TASK_PROTOCOL_ACTION}?task=${encodeURIComponent(id)}`;
}

/** The id of the reminder a task line was sent as, if it was. */
export function reminderIdOf(line: string): string | null {
  return REMINDER_LINK_PATTERN.exec(line)?.[2] ?? null;
}

export interface LinkSpan {
  /** Offsets of the link within the line: `[` inclusive, `)` exclusive. */
  from: number;
  to: number;
  id: string;
}

/** Where the reminder link sits in a line, for a renderer that replaces it. */
export function reminderLinkSpan(line: string): LinkSpan | null {
  const match = REMINDER_LINK_PATTERN.exec(line);
  if (!match) return null;
  const whole = match[0];
  const from = match.index + (whole.length - whole.trimStart().length);
  const to = match.index + whole.trimEnd().length;
  return { from, to, id: match[2] ?? "" };
}

/** The line with the reminder link at its end, replacing one already there. */
export function withReminderLink(line: string, id: string): string {
  const bare = line.replace(REMINDER_LINK_PATTERN, "").replace(/\s+$/, "");
  return `${bare} [${REMINDER_LINK_TEXT}](${taskLink(id)})`;
}

/** Six lowercase characters, the shape Obsidian gives its own block ids. */
export function generateTaskId(random: () => number = Math.random): string {
  let id = "";
  for (let index = 0; index < ID_LENGTH; index += 1) {
    const at = Math.min(ID_ALPHABET.length - 1, Math.floor(random() * ID_ALPHABET.length));
    id += ID_ALPHABET[at];
  }
  return id;
}

/** Whether the note already uses `id`, in a link or anywhere else. */
export function taskIdInUse(content: string, id: string): boolean {
  return content.includes(`task=${id})`);
}

/**
 * The line that carries the reminder link for `id`, or null. Every note is a
 * candidate, since the link does not say which note it is in.
 */
export function findTaskLine(content: string, id: string): number | null {
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (reminderIdOf(line) === id) return index;
  }
  return null;
}

/** The task's text without its list marker, checkbox and reminder link. Tags stay. */
export function taskTitle(line: string): string {
  const text = line.replace(TASK_PREFIX_PATTERN, "").replace(REMINDER_LINK_PATTERN, "").trim();
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
