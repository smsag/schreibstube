/** Columns of leading whitespace; a tab is four, as in Obsidian's own indentation. */
export function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

/** Plain code-unit order: the same answer on every device and engine. */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
