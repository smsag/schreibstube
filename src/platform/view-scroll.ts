import type { MarkdownView } from "obsidian";

/**
 * A note's place in source lines, through the scroll position Obsidian keeps
 * in lines (the one that carries a note's place between modes).
 */

/** The zero-based source line at the top of the note, or null while it is not laid out. */
export function viewTopLine(view: MarkdownView): number | null {
  const scroll: unknown = view.currentMode.getScroll();
  return typeof scroll === "number" && Number.isFinite(scroll)
    ? Math.max(0, Math.round(scroll))
    : null;
}

/**
 * Bring a heading's line to the top of the note, under the overlay, where the
 * stack then shows it as the current section. Centring it, as before, left
 * the section above it at the top and in the stack. The cursor stays where
 * it was, as for the note index: on it, a phone opened the keyboard over the
 * section and Live Preview opened the heading up to its markup.
 */
export function scrollViewToLine(view: MarkdownView, lineNumber: number): void {
  view.currentMode.applyScroll(lineNumber);
}
