/**
 * How often an `obsidian://` link may make the plugin act.
 *
 * Any web page can open such a link, and a page can open it in a loop. The
 * new-note link reads nothing it is given, so it cannot be told what to write
 * — but each call still creates a note and, on a desktop, a window, and a
 * hundred of each is a vault and a screen somebody else filled. A person
 * pressing a shortcut does not make two notes within seconds of each other,
 * so a call inside the window after the last one that was acted on is
 * ignored. The window counts from the last call acted on, not the last one
 * received, so a page that keeps calling does not keep the link shut for the
 * person who wants to use it.
 */

/** The least time between two calls acted on. */
export const NEW_NOTE_LINK_INTERVAL_MS = 5_000;

/** Whether a call arriving at `now` is acted on, given when the last one was. */
export function linkCallAllowed(
  lastActedAt: number | null,
  now: number,
  intervalMs: number = NEW_NOTE_LINK_INTERVAL_MS
): boolean {
  if (lastActedAt === null) return true;
  // A clock set back makes the last call look as if it came from the future;
  // that is no reason to shut the link until the clock catches up.
  if (now < lastActedAt) return true;
  return now - lastActedAt >= intervalMs;
}
