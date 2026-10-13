/**
 * Whether a line is a writer's aside rather than text: it starts with `//`.
 *
 * Indentation is allowed, so an aside nested under a list item still counts,
 * but the slashes must open the line — a URL's `https://` mid-sentence is text.
 */
export function isCommentLine(text: string): boolean {
  return /^\s*\/\//.test(text);
}
