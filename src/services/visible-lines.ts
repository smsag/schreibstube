/**
 * The lines an editor has on screen, as runs of line numbers.
 *
 * CodeMirror reports what it draws as ranges of positions, split around
 * every stretch drawn as something else: a fold, but also inline maths or a
 * long link in Live Preview, which sit inside a single line. Walked range by
 * range, that line came up twice, and a line decoration added again after a
 * mark further along the same line broke the order a decoration set must be
 * built in, which took the whole extension down. Each line is in exactly one
 * run here, and the runs come in order.
 */

export interface LineRun {
  first: number;
  last: number;
}

export function visibleLineRuns(
  ranges: readonly { from: number; to: number }[],
  lineNumberAt: (position: number) => number
): LineRun[] {
  const runs: LineRun[] = [];
  for (const range of ranges) {
    const first = lineNumberAt(range.from);
    const last = lineNumberAt(range.to);
    const previous = runs[runs.length - 1];
    if (previous && first <= previous.last + 1) previous.last = Math.max(previous.last, last);
    else runs.push({ first, last });
  }
  return runs;
}
