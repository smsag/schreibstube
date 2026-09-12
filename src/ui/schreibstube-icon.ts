/**
 * The plugin's own icon: a house with a quill, for "Stube".
 *
 * One shape for the ribbon button and for the pane's tab, so the thing a person
 * clicks and the thing that appears look like each other. Registering it
 * ourselves also removes the question the old code had to ask — whether the set
 * Obsidian ships carries the name we want — because a registered icon cannot be
 * missing.
 *
 * Obsidian draws a registered icon inside a `viewBox="0 0 100 100"`, while the
 * artwork is authored on Lucide's 24-unit grid. The group scales it up rather
 * than the paths being rewritten, so the file still holds the coordinates the
 * design hands over, and the stroke scales with them.
 */
import { addIcon } from "obsidian";

export const SCHREIBSTUBE_ICON = "schreibstube";

/** 100 / 24, so the 24-unit artwork fills Obsidian's box. */
const GRID_SCALE = 25 / 6;

const ARTWORK = [
  '<path d="M4 10.5 12 4l8 6.5"/>',
  '<path d="M6 9.5V20h12V9.5"/>',
  '<path d="M10 16.5l3-3 1.5 1.5-3 3-2 .5z"/>'
].join("");

export const SCHREIBSTUBE_ICON_SVG =
  `<g fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="round" stroke-linejoin="round" ` +
  `transform="scale(${GRID_SCALE})">${ARTWORK}</g>`;

/** Called once on load, before anything asks for the icon by name. */
export function registerSchreibstubeIcon(): void {
  addIcon(SCHREIBSTUBE_ICON, SCHREIBSTUBE_ICON_SVG);
}
