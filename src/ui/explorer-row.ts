/**
 * Put a row of the file pane at its depth.
 *
 * Depth is handed to CSS rather than resolved to pixels here, so the base
 * padding and the step per level are stated once in the stylesheet and every
 * section — pinned, bookmarks, latest, the tree — sits on the same grid. A row
 * at depth 0 in one section lines up with a row at depth 0 in another, which is
 * what makes the icon column read as a column.
 */
export function indent(row: HTMLElement, depth: number): void {
  row.style.setProperty("--schreibstube-depth", String(depth));
}
