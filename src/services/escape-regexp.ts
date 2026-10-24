/**
 * Text as a regular expression that matches it literally.
 *
 * One rule for every matcher that builds a pattern from what a note says —
 * a glossary term, a link being renamed, a project's tag — so the three
 * cannot come to disagree about which characters are special.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
