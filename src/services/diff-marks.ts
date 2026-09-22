/**
 * How one diff segment is drawn.
 *
 * A segment can span several lines, and the panel renders it with
 * `white-space: pre-wrap`, so its newlines are real line breaks. The stroke
 * uses `box-decoration-break: clone` to land and lift on every line — which
 * gives a BLANK line a fragment of its own: no text, but the mark's 0.42em of
 * side padding on each end, painted as a small stub floating between two
 * paragraphs.
 *
 * The fix is not to draw the mark there. A line with nothing on it has nothing
 * to mark, and the break between two paragraphs is not part of the change.
 */
export interface DiffPart {
  text: string;
  /** Whether the mark is painted over this part. */
  marked: boolean;
}

/**
 * The parts of a segment, with the blank lines left unmarked.
 *
 * A segment with no line break is returned whole and marked, whatever it
 * holds: a single space between two changed words is a real part of the
 * change, and dropping its mark would break the stroke between them.
 */
export function diffParts(text: string): DiffPart[] {
  const lines = text.split("\n");
  if (lines.length === 1) return [{ text, marked: true }];

  const parts: DiffPart[] = [];
  lines.forEach((line, index) => {
    if (index > 0) parts.push({ text: "\n", marked: false });
    if (line.length === 0) return;
    // Whitespace-only counts as blank: an indented empty line is still empty,
    // and marking it paints the same stub one tab further along.
    parts.push({ text: line, marked: line.trim().length > 0 });
  });
  return parts;
}
