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

/**
 * The run of backticks or tildes opening or closing a fence, if this is one.
 *
 * A backtick fence's info string cannot hold a backtick (CommonMark):
 * "```inline``` code" is inline code on a line, not a block that eats the
 * rest of the note.
 */
export function fenceMarker(line: string): string | null {
  const match = FENCE_PATTERN.exec(line);
  if (!match) return null;
  const marker = match[0].trimStart();
  return marker[0] === "`" && line.includes("`", match[0].length) ? null : marker;
}

/**
 * Whether a line closes the fence `open` began: the same character, at least
 * as many of it, and nothing after it. "```js" inside a block is a line of the
 * sample rather than its end, and ending there let the code below it be read
 * as Markdown.
 */
export function closesFence(line: string, open: string): boolean {
  const marker = fenceMarker(line);
  return (
    marker !== null &&
    marker[0] === open[0] &&
    marker.length >= open.length &&
    line.trim() === marker
  );
}

/**
 * The language a fence's opening line names: the first word after the
 * marker, in lower case, or "" for a fence that names none.
 */
export function fenceLanguage(line: string, marker: string): string {
  const info = line.trimStart().slice(marker.length).trim();
  return (info.split(/\s+/)[0] ?? "").toLowerCase();
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
      if (closesFence(line, fence)) fence = null;
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
