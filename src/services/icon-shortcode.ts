/**
 * `:folder:` in a note, and the moment a person starts typing one.
 *
 * The plugin's icons are a font, not characters: a glyph exists only where
 * the font is installed and the class applied, and pasted anywhere else it
 * is an empty box. So what goes into the note is a name between colons —
 * the form Slack and GitHub taught everybody — which the plugin draws as the
 * glyph and every other reader sees as a word that says what was meant.
 *
 * Two decisions live here and nowhere else. Where in a document a shortcode
 * counts: not in code, not in a link, not in a URL, not in a time. And when
 * a colon someone is typing is the start of one: German prose is full of
 * colons — "Beispiel: der Fall" — and a picker that opened on every one of
 * them would be turned off within the hour.
 *
 * The icon names are handed in rather than imported, so this module knows
 * nothing about the font and the tests need nothing from it.
 */

import { overlapsAny, segmentMarkdown } from "./markdown-segments";

/** A shortcode found in a document, with absolute offsets. */
export interface ShortcodeHit {
  from: number;
  to: number;
  name: string;
}

/**
 * The shape of a shortcode: a name that starts with a letter.
 *
 * Starting with a letter is what keeps `10:30:45` out — `:30:` is not a
 * name — and a URL's `://` never has a letter after the colon either.
 */
const SHORTCODE = /:([a-z][a-z0-9-]*):/g;

/**
 * Every shortcode in `text` that names an icon, outside code and links.
 *
 * The document is cut into prose blocks first, the way the proofreader cuts
 * it: fenced code and frontmatter are not prose and never reach the regex,
 * and inline code, links and tags are protected ranges inside a block that
 * a match may not touch. A name the font does not have is left as text:
 * `:note:` in a sentence about notes is a sentence, not a missing icon.
 */
export function findShortcodes(text: string, isIcon: (name: string) => boolean): ShortcodeHit[] {
  const hits: ShortcodeHit[] = [];

  for (const block of segmentMarkdown(text).blocks) {
    SHORTCODE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SHORTCODE.exec(block.text)) !== null) {
      const name = match[1] ?? "";
      const from = match.index;
      const to = from + match[0].length;
      if (!isIcon(name) || overlapsAny(block.protectedRanges, from, to)) {
        // A match that ends in a colon may be the start of the next one:
        // `:a::b:` is `:a:` and `:b:`. Step back over the closing colon.
        SHORTCODE.lastIndex = to - 1;
        continue;
      }
      hits.push({ from: block.from + from, to: block.from + to, name });
      SHORTCODE.lastIndex = to - 1;
    }
  }

  return hits;
}

/** How much of a name has to be typed before the picker opens. */
export const MIN_TRIGGER_CHARS = 2;

/** A shortcode being typed: where its colon is on the line, and the text so far. */
export interface ShortcodeTrigger {
  /** Offset of the colon within the line. */
  from: number;
  query: string;
}

/**
 * Whether the text before the cursor ends in a shortcode being typed.
 *
 * The colon has to begin a word — at the line's start, or after a space or
 * an opening bracket or quote — so a colon that follows a word, which is
 * what a colon in prose does, never opens the picker. After it, at least
 * two name characters and no space: one character is a typo more often
 * than the start of an icon, and a space means the colon was punctuation
 * after all.
 */
export function shortcodeTrigger(lineBeforeCursor: string): ShortcodeTrigger | null {
  const match = /(?:^|[\s([{"'„«])(:([a-z0-9-]*))$/i.exec(lineBeforeCursor);
  if (!match) return null;
  const query = (match[2] ?? "").toLowerCase();
  if (query.length < MIN_TRIGGER_CHARS) return null;
  return { from: lineBeforeCursor.length - (match[1]?.length ?? 0), query };
}

/** What replaces the typed `:que` once an icon is chosen. */
export function completedShortcode(name: string): string {
  return `:${name}: `;
}

/**
 * The icons offered for a query, best first: names that start with it, then
 * names that merely contain it, each group in the catalogue's order.
 */
export function rankIcons(names: readonly string[], query: string, limit: number): string[] {
  const needle = query.toLowerCase();
  const starts = names.filter((name) => name.startsWith(needle));
  const contains = names.filter((name) => !name.startsWith(needle) && name.includes(needle));
  return [...starts, ...contains].slice(0, limit);
}
