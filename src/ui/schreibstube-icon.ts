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
 *
 * The design's house occupies 16 of those 24 units. Lucide, which is what every
 * icon beside it in the ribbon comes from, draws to about 20: Obsidian's own
 * `folder` measures 20 wide, 91.7% of the box once its stroke is counted. Left
 * at its authored size the house read as a smaller, lighter icon among them, so
 * the scale carries an extra 1.25 to put it on Lucide's optical size. The
 * stroke thickens with it, which is what drawing a thing larger means.
 */
import { addIcon } from "obsidian";

export const SCHREIBSTUBE_ICON = "schreibstube";

/** 100 / 24, taking the 24-unit grid to Obsidian's 100-unit box. */
const GRID_SCALE = 25 / 6;

/** 20 / 16: the house drawn to the width Lucide's own icons occupy. */
const OPTICAL_SCALE = 1.25;

/** Rounded, so binary floating point does not leak into the markup. */
const round = (value: number): number => Math.round(value * 1e4) / 1e4;

const EXACT_SCALE = GRID_SCALE * OPTICAL_SCALE;

export const SCALE = round(EXACT_SCALE);

/** Keeps the artwork's centre (12, 12) on the box's centre (50, 50). Derived
 *  from the exact scale, so rounding the one does not shift the other. */
export const OFFSET = round(50 - 12 * EXACT_SCALE);

/** Where the artwork's 24-unit bounding box lands in the 100-unit box. */
export function mappedExtent(): { min: number; max: number } {
  return { min: round(4 * SCALE + OFFSET), max: round(20 * SCALE + OFFSET) };
}

const ARTWORK = [
  '<path d="M4 10.5 12 4l8 6.5"/>',
  '<path d="M6 9.5V20h12V9.5"/>',
  '<path d="M10 16.5l3-3 1.5 1.5-3 3-2 .5z"/>'
].join("");

export const SCHREIBSTUBE_ICON_SVG =
  `<g fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="round" stroke-linejoin="round" ` +
  `transform="translate(${OFFSET} ${OFFSET}) scale(${SCALE})">${ARTWORK}</g>`;

/** Called once on load, before anything asks for the icon by name. */
export function registerSchreibstubeIcon(): void {
  addIcon(SCHREIBSTUBE_ICON, SCHREIBSTUBE_ICON_SVG);
}
