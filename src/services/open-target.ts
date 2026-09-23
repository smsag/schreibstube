/**
 * Where a press on a picture in the tile grid opens it.
 *
 * In the grid's own tab, so that Back returns to the grid: a picture opened
 * from an overview is a detour, and the way back from a detour is the Back
 * arrow, not the folder's menu a second time. A modifier press opens a new
 * tab instead, as a modifier click does in Obsidian's own file explorer,
 * for a person who wants the grid and the picture side by side.
 *
 * A keyboard press carries no event and opens in place.
 */
export type OpenTarget = "here" | "tab";

export function pressTarget(modifiers?: { ctrlKey?: boolean; metaKey?: boolean }): OpenTarget {
  return modifiers?.ctrlKey || modifiers?.metaKey ? "tab" : "here";
}
