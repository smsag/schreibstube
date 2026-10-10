/**
 * What the character in a task's box means, in one place.
 *
 * Markdown itself knows two boxes, `[ ]` and `[x]`. Everything else — `[/]`,
 * `[-]`, `[>]`, `[?]`, `[!]` — is a convention a theme or a plugin gives a
 * meaning to, and the plugin counted all of them as done, so a task someone
 * had started was announced as finished in the Explorer, the ribbon and on
 * paper. Four states are all this plugin reads: `[x]` and `[X]` are done,
 * `[-]` is cancelled, `[/]` is work in progress, and every other mark is an
 * open task carrying a flag the plugin does not interpret.
 *
 * Cancelled is finished — it is not work left, so it counts toward the done
 * figure wherever a number is shown — but it was not done, so the places with
 * room for it say so, and **Tidy up done tasks** leaves it in the note as the
 * record of a decision.
 *
 * Every counter, fold and renderer goes through this, so a marker cannot mean
 * one thing in the Explorer and another in **Tidy up done tasks**.
 */

export type TaskState = "open" | "progress" | "done" | "cancelled";

export function taskState(marker: string): TaskState {
  if (marker === "x" || marker === "X") return "done";
  if (marker === "-") return "cancelled";
  return marker === "/" ? "progress" : "open";
}

/** Open work, started or not: everything that is neither done nor cancelled. */
export function isOpenTask(marker: string): boolean {
  const state = taskState(marker);
  return state === "open" || state === "progress";
}
