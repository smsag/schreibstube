/**
 * The plugin's own icon: a speech bubble holding a small branch graph — text
 * that has been talked over, and the versions it went through.
 *
 * One shape for the ribbon button, the entry command and the pane's tab, so
 * the thing a person clicks and the thing that appears look like each other.
 * Registering it ourselves also removes the question the old code had to ask —
 * whether the set Obsidian ships carries the name we want — because a
 * registered icon cannot be missing.
 *
 * It sits in a row of Lucide icons, and a row reads as one thing only when
 * every glyph in it keeps the same rules: the 24-unit grid, Obsidian's own
 * stroke width (inherited, see below), round caps and joins, 18 of 24 units
 * wide, stroke only, and `currentColor`
 * so the icon follows the theme and the accent rather than carrying a colour
 * of its own. The geometry is the designed one and is not edited here.
 *
 * Obsidian draws a registered icon inside a `viewBox="0 0 100 100"`, while the
 * artwork is authored on the 24-unit grid. The group scales it rather than the
 * paths being rewritten, so the file still holds the coordinates the design
 * hands over, and the stroke scales with them.
 */
import { addIcon } from "obsidian";

export const SCHREIBSTUBE_ICON = "schreibstube-logo";

/** 100 / 24, taking the 24-unit grid to Obsidian's 100-unit box. */
const GRID_SCALE = 25 / 6;

/** Rounded, so binary floating point does not leak into the markup. */
const round = (value: number): number => Math.round(value * 1e4) / 1e4;

export const SCALE = round(GRID_SCALE);

/** Keeps the artwork's centre (12, 12) on the box's centre (50, 50). */
export const OFFSET = round(50 - 12 * GRID_SCALE);

/** Where the bubble's 18-unit bounding box (3 to 21) lands in the 100-unit box. */
export function mappedExtent(): { min: number; max: number } {
  return { min: round(3 * SCALE + OFFSET), max: round(21 * SCALE + OFFSET) };
}

/** The bubble spans 3 to 21 of the grid, as Lucide's own bubble does. */
const ARTWORK = [
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  '<circle cx="9" cy="7.5" r="1.5"/>',
  '<circle cx="9" cy="12.5" r="1.5"/>',
  '<circle cx="15.5" cy="7.5" r="1.5"/>',
  '<path d="M9 9v2"/>',
  '<path d="M15.5 9a5 5 0 0 1-5 3.5"/>'
].join("");

/**
 * No `stroke-width` here, deliberately. Obsidian's `.svg-icon` sets
 * `stroke-width: var(--icon-stroke)` — 1.75px in a sidebar tab, other values in
 * the ribbon and menus — and a Lucide icon has no attribute of its own, so it
 * inherits that. An attribute on this group would block it, and the group's
 * `scale()` multiplies the stroke along with the geometry: a hardcoded 2 drew
 * at 8.33% of the icon's width where every neighbour sat at 7.29%, and that
 * extra weight reads in the row as a darker glyph rather than a bolder one.
 * `assets/logo.svg` keeps its own `stroke-width`: a standalone file has no
 * stylesheet to inherit from, and 2 on the 24-unit grid is Lucide's own value.
 */
export const SCHREIBSTUBE_ICON_SVG =
  `<g fill="none" stroke="currentColor" ` +
  `stroke-linecap="round" stroke-linejoin="round" ` +
  `transform="translate(${OFFSET} ${OFFSET}) scale(${SCALE})">${ARTWORK}</g>`;

/** Called once on load, before anything asks for the icon by name. */
export function registerSchreibstubeIcon(): void {
  addIcon(SCHREIBSTUBE_ICON, SCHREIBSTUBE_ICON_SVG);
}
