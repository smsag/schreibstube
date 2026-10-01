/**
 * A base's rows as pictures, each leading to the note it appears in.
 *
 * The star on a picture is kept in its description note, because a picture
 * has no frontmatter to hold it, so a base of favourites lists description
 * notes. Nobody stars a picture to read its description, though: the picture
 * was worth keeping for the article it was in, and the article is what a
 * person wants back. Obsidian's own cards open the row, which is the
 * description; this decides, for each row, which picture it stands for and
 * which notes that picture appears in, so a card can show the one and open
 * the other.
 *
 * Pure: the view hands over the rows in the base's order and what the
 * metadata cache knows, and draws what comes back.
 */

/**
 * How many cards a view draws before it stops and says how many more there
 * are. The same reasoning as the folder grid's: each card is a picture the
 * browser decodes as it scrolls in, and a base without a filter lists the
 * whole vault.
 */
export const MAX_PICTURE_CARDS = 400;

/** What the vault knows, asked one path at a time. */
export interface PictureCardSources {
  /** The picture a note describes, or null when it describes none that is there. */
  imageDescribedBy(path: string): string | null;
  /** Whether a path is a picture a card can show. */
  isPicture(path: string): boolean;
  /** Whether a note describes a picture, there or gone. */
  isDescriptionNote(path: string): boolean;
  /** Every file that links to or embeds this one. */
  referrers(path: string): readonly string[];
  /** When a file last changed, in milliseconds since the epoch. */
  modifiedAt(path: string): number;
}

export interface PictureCard {
  picture: string;
  /** The row the base listed for it: a description note, or the picture itself. */
  entry: string;
  /** The notes the picture appears in, the most recently changed first. */
  articles: string[];
}

export interface PictureCards {
  cards: PictureCard[];
  /** Pictures beyond those drawn. */
  held: number;
  /** Rows that are neither a picture nor a note describing one. */
  skipped: number;
}

/** The picture a row stands for: itself, or the one it describes. */
export function pictureOfRow(path: string, sources: PictureCardSources): string | null {
  if (sources.isPicture(path)) return path;
  return sources.imageDescribedBy(path);
}

/**
 * The notes a picture appears in.
 *
 * A description note embeds its picture and links it from the frontmatter,
 * so it is always among the referrers, and it is never the article: that is
 * the whole reason this exists. Only Markdown counts — a canvas holding the
 * picture is a board, not something to read. The most recently changed note
 * comes first, as the likeliest one being worked on; the path settles a tie,
 * so the order does not depend on how the vault listed them.
 */
export function articlesOf(picture: string, sources: PictureCardSources): string[] {
  const articles = new Set<string>();
  for (const path of sources.referrers(picture)) {
    if (!path.toLowerCase().endsWith(".md") || sources.isDescriptionNote(path)) continue;
    articles.add(path);
  }
  return [...articles].sort(
    (a, b) => sources.modifiedAt(b) - sources.modifiedAt(a) || a.localeCompare(b)
  );
}

/**
 * The cards for a base's rows, in the base's order.
 *
 * A picture listed twice — its description note and the picture itself both
 * match the filter — is one card, where it first appears. Articles are looked
 * up only for the cards drawn.
 */
export function pictureCards(
  rows: readonly string[],
  sources: PictureCardSources,
  max = MAX_PICTURE_CARDS
): PictureCards {
  const cards: PictureCard[] = [];
  const seen = new Set<string>();
  let held = 0;
  let skipped = 0;

  for (const entry of rows) {
    const picture = pictureOfRow(entry, sources);
    if (picture === null) {
      skipped += 1;
      continue;
    }
    if (seen.has(picture)) continue;
    seen.add(picture);
    if (cards.length >= max) {
      held += 1;
      continue;
    }
    cards.push({ picture, entry, articles: articlesOf(picture, sources) });
  }

  return { cards, held, skipped };
}

/** The layout's setting for how an article opens, as the `.base` file keeps it. */
export const READING_VIEW_OPTION = "readingView";

/**
 * Whether an article opens in Reading view. On unless the base says no: a
 * base nobody has set up gets what the layout is for. The file is edited by
 * hand as well as through the toggle, so `"false"` written as text means
 * what it says; anything else keeps the default.
 */
export function opensInReadingView(value: unknown): boolean {
  if (value === false) return false;
  return !(typeof value === "string" && value.trim().toLowerCase() === "false");
}

/** What a press on a card does. */
export type CardPress =
  | { kind: "article"; path: string }
  | { kind: "choose"; paths: string[] }
  | { kind: "picture"; path: string };

/**
 * One article opens; several are offered, since choosing for the person
 * would hide the others behind a card that looks like one; none, and the
 * picture itself is what there is to see.
 */
export function cardPress(card: PictureCard): CardPress {
  const [first, ...rest] = card.articles;
  if (first === undefined) return { kind: "picture", path: card.picture };
  if (rest.length === 0) return { kind: "article", path: first };
  return { kind: "choose", paths: [...card.articles] };
}
