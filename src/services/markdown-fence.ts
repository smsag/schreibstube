/**
 * Where a fenced code block starts and stops.
 *
 * Anything that reads a note line by line has to know: a `#` inside a fence is
 * a comment or a shell prompt, a `##` inside one is not a section boundary, and
 * treating either as Markdown puts text where it does not belong. Two places
 * learned that separately, which is one more than the rule should live in.
 */

/**
 * A fence opens with three or more backticks or tildes and closes with at least
 * as many of the same character — so a block fenced with four can quote one of
 * three without ending itself.
 */
const FENCE_PATTERN = /^\s*([`~])\1{2,}/;

/** The run of backticks or tildes opening or closing a fence, if this is one. */
export function fenceMarker(line: string): string | null {
  const match = FENCE_PATTERN.exec(line);
  return match ? match[0].trimStart() : null;
}

/**
 * Whether each line sits inside a fenced block.
 *
 * The fence lines themselves count as inside: they are the block's own
 * punctuation, not content to be read. An unclosed fence stays open to the end
 * of the note rather than guessing where it was meant to stop, which is the
 * reading Obsidian gives it too.
 */
export function fencedLines(lines: readonly string[]): boolean[] {
  const inside: boolean[] = [];
  let fence: string | null = null;

  for (const line of lines) {
    const marker = fenceMarker(line);

    if (fence) {
      inside.push(true);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }

    if (marker) {
      fence = marker;
      inside.push(true);
      continue;
    }

    inside.push(false);
  }

  return inside;
}
