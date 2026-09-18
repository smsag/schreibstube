/**
 * Which notes belong with the one in front of you, and why.
 *
 * A vault is not a pile of documents: it is a graph somebody built by hand.
 * Every wikilink, every backlink, every tag and every folder is a person having
 * already said that two notes belong together. Nothing here has to guess at
 * meaning, because the meaning was written down — which is why this needs no
 * model, no index to download, no vector store and no network, and answers the
 * same way on a phone as on a desktop.
 *
 * Five signals, in the order they are worth anything:
 *
 * **A link either way** is the strongest thing a vault can say. Somebody wrote
 * it deliberately, on purpose, about these two notes.
 *
 * **Shared links** — both notes point at the same third note. Two Exposés that
 * both link `Objekt 12` are about the same object.
 *
 * **Co-citation** — both notes are pointed at by the same third note. This is
 * the signal that finds siblings: two viewing appointments listed in the same
 * Objekt note have nothing in common textually and everything in common in
 * fact.
 *
 * **Shared tags** — a deliberate label, but one describing a group rather than
 * this note.
 *
 * **The same folder** — the weakest, and only ever a tiebreak.
 *
 * Every shared thing is weighted by how rare it is, which is the whole
 * difference between this working and not. An index note linking to four
 * hundred notes makes all four hundred "co-cited" and says nothing about any of
 * them; a note linked by exactly two says a great deal about those two. Without
 * the weighting, the most connected note in the vault would be everybody's top
 * result, and a list where the same five notes answer every question is a list
 * nobody opens twice.
 *
 * Pure: it is handed the graph and returns an order. The controller reads
 * Obsidian's metadata cache, which has already resolved every link in the
 * vault, so asking this costs no file reads at all.
 */

/** One note as the ranking sees it. */
export interface RelatedSubject {
  path: string;
  /** Vault paths this note links to, resolved and deduplicated. */
  links: readonly string[];
  /** Vault paths that link to this note. */
  backlinks: readonly string[];
  /** The note's tags, lowercased, without the `#`. */
  tags: readonly string[];
  /** The folder holding the note; the empty string for the vault root. */
  folder: string;
  modifiedAt: number;
}

/** Why a note is on the list. The view turns these into the row's chips. */
export type RelatedReasonKind = "link" | "shared-link" | "co-citation" | "tag" | "folder";

export interface RelatedReason {
  kind: RelatedReasonKind;
  /** How many things of that kind are shared. A direct link counts once. */
  count: number;
}

export interface RelatedNote {
  path: string;
  score: number;
  /** Strongest first, so a row can show the one that explains it best. */
  reasons: RelatedReason[];
  modifiedAt: number;
}

/**
 * What each signal is worth before rarity is taken into account.
 *
 * A direct link is a flat score rather than a weighted one: it is not evidence
 * that two notes might be related, it is a person saying they are, and no
 * amount of shared tags should outrank it.
 */
const WEIGHTS: Record<RelatedReasonKind, number> = {
  link: 3,
  "shared-link": 1,
  "co-citation": 1,
  tag: 0.6,
  folder: 0.35
};

/**
 * Smoothed inverse document frequency, the same shape the file filter uses: a
 * thing shared by everything still counts for a little, and a thing shared by
 * two notes counts for a lot.
 */
function idf(documentFrequency: number, total: number): number {
  return Math.log((total + 1) / (documentFrequency + 1)) + 1;
}

/**
 * How many results the sidebar is willing to draw.
 *
 * Not a filter but a cap: the number of notes sharing *something* with a note
 * grows with the vault, and past a screenful the answer is a better signal
 * rather than a longer list.
 */
export const RELATED_LIMIT = 20;

/**
 * Results scoring below this share of the best one are dropped.
 *
 * Relative rather than absolute for the same reason the filter's floor is: the
 * weights move with the size of the vault, so a fixed number would mean two
 * different things in two different vaults. Without it, every note sharing one
 * common tag with the source trails the list forever.
 */
export const RELATED_FLOOR = 0.2;

/**
 * Obsidian's own resolved-link table: which note links to which, already
 * resolved to the files the links land on.
 *
 * Declared structurally rather than imported, so this module stays free of
 * Obsidian the way every other decision module is.
 */
export type ResolvedLinks = Record<string, Record<string, number>>;

/**
 * Who links to each note, inverted from the table of who links to what.
 *
 * Obsidian offers a plugin no public call for a note's backlinks, and asking
 * per note would walk the whole table once per note. One pass builds the answer
 * for every note at once, which is the only shape that scales to a vault.
 *
 * A note linking to the same file twice appears once: the ranking counts things
 * two notes share, not links somebody wrote.
 */
export function backlinkIndex(resolved: ResolvedLinks): Map<string, string[]> {
  const backlinks = new Map<string, string[]>();
  for (const [source, targets] of Object.entries(resolved)) {
    for (const target of Object.keys(targets)) {
      const into = backlinks.get(target);
      if (into) {
        if (!into.includes(source)) into.push(source);
      } else {
        backlinks.set(target, [source]);
      }
    }
  }
  return backlinks;
}

/** How the graph is counted, once per query rather than once per candidate. */
interface Frequencies {
  /** How many notes link to each path. */
  inbound: Map<string, number>;
  /** How many links each note sends, which is what makes an index note cheap. */
  outbound: Map<string, number>;
  tags: Map<string, number>;
  folders: Map<string, number>;
  total: number;
}

function countFrequencies(notes: readonly RelatedSubject[]): Frequencies {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const tags = new Map<string, number>();
  const folders = new Map<string, number>();

  for (const note of notes) {
    outbound.set(note.path, note.links.length);
    for (const link of note.links) inbound.set(link, (inbound.get(link) ?? 0) + 1);
    for (const tag of note.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    folders.set(note.folder, (folders.get(note.folder) ?? 0) + 1);
  }

  return { inbound, outbound, tags, folders, total: notes.length };
}

/** What the shared members of two sets are worth together. */
function sharedWeight(
  mine: ReadonlySet<string>,
  theirs: readonly string[],
  frequency: Map<string, number>,
  total: number
): { weight: number; count: number } {
  let weight = 0;
  let count = 0;
  for (const item of theirs) {
    if (!mine.has(item)) continue;
    count += 1;
    weight += idf(frequency.get(item) ?? 0, total);
  }
  return { weight, count };
}

/**
 * The notes most related to `sourcePath`, best first.
 *
 * The source is never in its own list, and a note sharing nothing is not on it
 * at all — an empty list is the honest answer for a note nobody has linked,
 * tagged or filed, and padding it with the rest of the folder would teach a
 * person to ignore the section.
 */
export function rankRelated(
  sourcePath: string,
  notes: readonly RelatedSubject[],
  options: { limit?: number } = {}
): RelatedNote[] {
  const source = notes.find((note) => note.path === sourcePath);
  if (!source) return [];

  const frequencies = countFrequencies(notes);
  const { total } = frequencies;

  const myLinks = new Set(source.links);
  const myBacklinks = new Set(source.backlinks);
  const myTags = new Set(source.tags);

  const ranked: RelatedNote[] = [];

  for (const note of notes) {
    if (note.path === sourcePath) continue;

    const reasons: RelatedReason[] = [];
    let score = 0;

    // A link in either direction is one fact, counted once: a pair of notes
    // that link to each other are not twice as related as a pair where one
    // links to the other, they are simply related.
    if (myLinks.has(note.path) || myBacklinks.has(note.path)) {
      score += WEIGHTS.link;
      reasons.push({ kind: "link", count: 1 });
    }

    // Both point at the same third note. Weighted by how often that third note
    // is pointed at, so sharing a link to an index everybody links to is worth
    // almost nothing and sharing a link to one particular Objekt is worth a lot.
    const links = sharedWeight(myLinks, note.links, frequencies.inbound, total);
    if (links.count > 0) {
      score += WEIGHTS["shared-link"] * links.weight;
      reasons.push({ kind: "shared-link", count: links.count });
    }

    // Both are pointed at by the same third note. Weighted by how many links
    // that third note sends: being listed together on a page of four hundred
    // links is a coincidence, being listed together on a page of three is not.
    const cited = sharedWeight(myBacklinks, note.backlinks, frequencies.outbound, total);
    if (cited.count > 0) {
      score += WEIGHTS["co-citation"] * cited.weight;
      reasons.push({ kind: "co-citation", count: cited.count });
    }

    const tags = sharedWeight(myTags, note.tags, frequencies.tags, total);
    if (tags.count > 0) {
      score += WEIGHTS.tag * tags.weight;
      reasons.push({ kind: "tag", count: tags.count });
    }

    // The folder only ever breaks a tie, and only in a folder small enough for
    // sitting in it to have meant something.
    if (note.folder === source.folder) {
      score += WEIGHTS.folder * idf(frequencies.folders.get(note.folder) ?? 0, total);
      reasons.push({ kind: "folder", count: 1 });
    }

    if (score <= 0) continue;

    reasons.sort((a, b) => WEIGHTS[b.kind] - WEIGHTS[a.kind]);
    ranked.push({ path: note.path, score, reasons, modifiedAt: note.modifiedAt });
  }

  // The most recently touched of two equally related notes is the one being
  // worked on, and a stable order beats one that shuffles between draws.
  ranked.sort(
    (a, b) => b.score - a.score || b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path)
  );

  const top = ranked[0]?.score ?? 0;
  const cutoff = top * RELATED_FLOOR;
  return ranked.filter((note) => note.score >= cutoff).slice(0, options.limit ?? RELATED_LIMIT);
}
