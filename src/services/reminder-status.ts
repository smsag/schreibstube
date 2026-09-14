/**
 * What Reminders reports as done, and how that reaches the note.
 *
 * The plugin cannot ask Reminders anything. A Shortcut can: find the
 * completed reminders in a list and hand back their notes, where every
 * reminder the plugin made carries its `obsidian://schreibstube?task=…` link.
 * The report reaches the plugin one of two ways — appended to a callback URL
 * when a command ran the Shortcut, or written into a file in the vault by an
 * automation — and either way it is text with links in it. The ids in that
 * text are the tasks to tick.
 *
 * Text in, text out, so all of it is tested without either application.
 */
import { reminderIdOf, taskLink } from "./reminder-export";
import { taskMarker } from "./task-summary";

/** The file an automation writes the report to, relative to the vault root. */
export const DEFAULT_REPORT_FILE = "schreibstube-reminders.txt";

/** The parameter that marks a protocol call as a status report. */
const STATUS_FLAG = "done";

const ID_IN_LINK = /schreibstube\?task=([A-Za-z0-9-]{1,64})/g;
const OPEN_BOX = /^(\s*(?:[-*+]|\d+[.)])\s+\[) \]/;

/** The ids of every task in a note that was sent to Reminders, in order, once each. */
export function sentTaskIds(content: string): string[] {
  const ids: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const id = reminderIdOf(line);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Every task id mentioned in a report, whatever else the text holds. */
export function idsInReport(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(ID_IN_LINK)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

export interface DoneApplied {
  content: string;
  /** The ids whose task went from open to done in this pass. */
  ticked: string[];
}

/**
 * Ticks every open task whose link names one of `ids`. A task already done
 * is left as it is, marker and all: what someone wrote in the box is theirs.
 */
export function applyDone(content: string, ids: readonly string[]): DoneApplied {
  if (ids.length === 0) return { content, ticked: [] };

  const wanted = new Set(ids);
  const ticked: string[] = [];
  const lines = content.split(/\r?\n/);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";

  const updated = lines.map((line) => {
    const id = reminderIdOf(line);
    if (!id || !wanted.has(id) || taskMarker(line) !== " ") return line;
    ticked.push(id);
    return line.replace(OPEN_BOX, "$1x]");
  });

  return { content: ticked.length > 0 ? updated.join(newline) : content, ticked };
}

export interface StatusRequest {
  /** The tasks to ask about; empty means every reminder in the list. */
  ids: string[];
  list: string;
}

/** Where the Shortcut sends its result: back into the plugin, flagged as a report. */
export function statusCallbackUrl(): string {
  return `obsidian://schreibstube?${STATUS_FLAG}=1`;
}

/**
 * The URL that runs the status Shortcut and has Shortcuts call back with its
 * output. Shortcuts appends the output as a `result` parameter to the
 * `x-success` URL, which is how the report arrives without a file.
 */
export function statusShortcutUrl(shortcut: string, request: StatusRequest): string {
  const name = encodeURIComponent(shortcut.trim());
  const payload = {
    ids: request.ids,
    links: request.ids.map(taskLink),
    list: request.list
  };
  const text = encodeURIComponent(JSON.stringify(payload));
  const success = encodeURIComponent(statusCallbackUrl());
  return `shortcuts://x-callback-url/run-shortcut?name=${name}&input=text&text=${text}&x-success=${success}`;
}

/** Whether a protocol call is a status report rather than a link to a task. */
export function isStatusCallback(params: Record<string, string>): boolean {
  return params[STATUS_FLAG] !== undefined;
}

/** The report text a status callback carries; empty when Shortcuts sent none. */
export function reportFromParams(params: Record<string, string>): string {
  return params.result ?? "";
}
