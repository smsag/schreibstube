/**
 * Which icon the ribbon actually gets.
 *
 * Obsidian types an icon name as a plain `string`, so nothing catches a name
 * its bundled set does not carry. There is no build error and no runtime error
 * either: `addRibbonIcon` draws an empty button, and the only clue anyone gets
 * is a blank square in the margin of the app.
 *
 * The set is readable at runtime, so the name is checked against it once and a
 * missing one steps down to an icon that has been there since the beginning.
 * A wrong-but-present icon is a small thing; a button with nothing on it reads
 * as a broken plugin.
 */

/**
 * Pick the icon to register.
 *
 * An empty `available` means the set could not be read at all, which is not
 * evidence against `preferred` — the caller's choice stands rather than being
 * overruled by a question that went unanswered.
 */
export function resolveIconName(
  preferred: string,
  available: readonly string[],
  fallback: string
): string {
  if (available.length === 0) return preferred;
  if (available.includes(preferred)) return preferred;
  return available.includes(fallback) ? fallback : preferred;
}
