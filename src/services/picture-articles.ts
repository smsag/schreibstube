/**
 * The notes a described picture appears in, as links its description keeps.
 *
 * The star on a picture is kept in its description note, because a picture
 * has no frontmatter to hold it, so a base of starred pictures lists
 * description notes. What a person wants back from one is the article the
 * picture was in, and nothing in the description named it: Obsidian's own
 * layouts show a note's properties, a formula cannot reliably find another
 * note's backlinks, and a plugin cannot change either. So the description
 * carries the links itself, under `schreibstubeArticles`, and every layout
 * shows them as it shows any property: a column in a table, a line on a card.
 *
 * Pure: the controller hands over who links to what, and writes the answer.
 */
import { isDrawing } from "./file-glyph";
import { basename, CONTROL_CHARS } from "./file-name";

/**
 * How many articles a description names. A picture embedded in a template
 * or a daily header can be in hundreds of notes; a property that long is
 * unreadable in any layout and rewritten whenever one of them changes.
 */
export const MAX_ARTICLE_LINKS = 50;

/** What the vault knows, asked one path at a time. */
export interface ArticleSources {
  /** Every file that links to or embeds this one. */
  referrers(path: string): readonly string[];
  /** Whether a note describes a picture, there or gone. */
  isDescriptionNote(path: string): boolean;
}

/** What breaks a wikilink when written inside one, or cannot be written at all. */
const UNLINKABLE = /[[\]|#^]/;

/**
 * The notes a picture appears in.
 *
 * A description note embeds its picture and links it from the frontmatter,
 * so it is always among the referrers, and it is never the article: that is
 * the whole reason this exists. Only Markdown counts, and of Markdown not an
 * Excalidraw drawing, which is a Markdown file only on disk: a board holding
 * the picture, canvas or drawing, is not something to read. A note whose
 * path cannot be written as a link is left out rather than written broken.
 *
 * Sorted by path, not by when a note changed: the list is written into a
 * file that syncs, and an order that moved with every edit would rewrite
 * the description on every device each time an article was saved.
 */
export function articlesOf(picture: string, sources: ArticleSources): string[] {
  const articles = new Set<string>();
  for (const path of sources.referrers(picture)) {
    if (!path.toLowerCase().endsWith(".md")) continue;
    if (UNLINKABLE.test(path) || CONTROL_CHARS.test(path)) continue;
    if (isDrawing(basename(path), "md") || sources.isDescriptionNote(path)) continue;
    articles.add(path);
  }
  return [...articles].sort((a, b) => a.localeCompare(b)).slice(0, MAX_ARTICLE_LINKS);
}

/** A note as a link in a property: its path without `.md`, which never resolves to another note of the same name. */
export function articleLink(path: string): string {
  return `[[${path.replace(/\.md$/i, "")}]]`;
}

export function articleLinks(paths: readonly string[]): string[] {
  return paths.map(articleLink);
}

/**
 * Whether a description already says what it should. The frontmatter is
 * anyone's to edit, so the stored value is checked for shape, not trusted:
 * anything other than the same links in the same order is a difference, and
 * a difference is the only reason to write.
 */
export function sameArticleLinks(current: unknown, wanted: readonly string[]): boolean {
  if (!Array.isArray(current) || current.length !== wanted.length) return false;
  return current.every((value, index) => value === wanted[index]);
}

/**
 * The links a description held, for writing the description anew: kept, as
 * the star is, so a picture described again does not lose them until the
 * next pass. Only a list of well-formed links is carried over, at most the
 * bound; anything else is dropped and the next pass writes it fresh.
 */
export function carriedArticleLinks(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && /^\[\[[^[\]|#^]+\]\]$/.test(entry) && !CONTROL_CHARS.test(entry)
  );
  return links.slice(0, MAX_ARTICLE_LINKS);
}
