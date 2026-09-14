/**
 * The plugin's own icon: a house with a quill, for "Stube".
 *
 * One shape for the ribbon button and for the pane's tab, so the thing a person
 * clicks and the thing that appears look like each other. Registering it
 * ourselves also removes the question the old code had to ask — whether the set
 * Obsidian ships carries the name we want — because a registered icon cannot be
 * missing.
 *
 * It sits in a row of Lucide icons, and a row reads as one thing only when
 * every glyph in it keeps the same rules. So the house is Lucide's own house —
 * the same rounded outline, on the same 24-unit grid, at the same 2-unit
 * stroke, filling the same 18 of 24 — with the quill inside where Lucide puts
 * the door. An earlier drawing was scaled up to a folder's width and stroked
 * heavier, and read as a stranger among the three beside it, standing closer to
 * the window's edge than they did.
 *
 * Obsidian draws a registered icon inside a `viewBox="0 0 100 100"`, while the
 * artwork is authored on the 24-unit grid. The group scales it rather than the
 * paths being rewritten, so the file still holds the coordinates the design
 * hands over, and the stroke scales with them.
 */
import { addIcon } from "obsidian";

export const SCHREIBSTUBE_ICON = "schreibstube";

/** 100 / 24, taking the 24-unit grid to Obsidian's 100-unit box. */
const GRID_SCALE = 25 / 6;

/** Rounded, so binary floating point does not leak into the markup. */
const round = (value: number): number => Math.round(value * 1e4) / 1e4;

export const SCALE = round(GRID_SCALE);

/** Keeps the artwork's centre (12, 12) on the box's centre (50, 50). */
export const OFFSET = round(50 - 12 * GRID_SCALE);

/** Where the house's 18-unit bounding box (3 to 21) lands in the 100-unit box. */
export function mappedExtent(): { min: number; max: number } {
  return { min: round(3 * SCALE + OFFSET), max: round(21 * SCALE + OFFSET) };
}

/** Lucide's house outline, verbatim, and a quill in the doorway. */
const ARTWORK = [
  '<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  '<path d="M9.5 17.5 13 14l1.5 1.5-3.5 3.5-2 .5z"/>'
].join("");

export const SCHREIBSTUBE_ICON_SVG =
  `<g fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" ` +
  `transform="translate(${OFFSET} ${OFFSET}) scale(${SCALE})">${ARTWORK}</g>`;

/** Called once on load, before anything asks for the icon by name. */
export function registerSchreibstubeIcon(): void {
  addIcon(SCHREIBSTUBE_ICON, SCHREIBSTUBE_ICON_SVG);
}
