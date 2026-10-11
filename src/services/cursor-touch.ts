/**
 * Whether a cursor or selection is on a stretch of text.
 *
 * Text that a widget stands in for is shown as the widget except where a
 * person is editing it, and "editing it" is a cursor inside the stretch, a
 * cursor at either edge, or a selection that overlaps it. The edges count
 * because that is where a cursor arrives from either side: it has to see the
 * source before it can step into it.
 */
export interface SelectionRange {
  from: number;
  to: number;
}

export function touchesRange(
  selection: readonly SelectionRange[],
  from: number,
  to: number
): boolean {
  return selection.some((range) => range.from <= to && range.to >= from);
}
