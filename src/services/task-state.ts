/**
 * What the character in a task's box means, in one place.
 *
 * Markdown itself knows two boxes, `[ ]` and `[x]`. Everything else — `[/]`,
 * `[-]`, `[>]`, `[?]`, `[!]` — is a convention a theme or a plugin gives a
 * meaning to, and the plugin counted all of them as done, so a task someone
 * had started was announced as finished in the Explorer, the ribbon and on
 * paper. Three states are all this plugin reads: finished is `[x]`, `[X]` and
 * `[-]` (cancelled is not work left), `[/]` is work in progress, and every
 * other mark is an open task carrying a flag the plugin does not interpret.
 *
 * Every counter, fold and renderer goes through this, so a marker cannot mean
 * one thing in the Explorer and another in **Tidy up done tasks**.
 */

export type TaskState = "open" | "progress" | "done";

const DONE = new Set(["x", "X", "-"]);

export function taskState(marker: string): TaskState {
  if (DONE.has(marker)) return "done";
  return marker === "/" ? "progress" : "open";
}

/** Open work, started or not: everything that is not finished. */
export function isOpenTask(marker: string): boolean {
  return taskState(marker) !== "done";
}
