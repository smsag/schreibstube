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
 * **The same folder** — the weakest, and only ever a tiebreak: it orders notes
 * that already share something, and never puts a note on the list alone.
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
import { comparePaths } from "./file-search";
import { idf } from "./idf";

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
 * How many results the sidebar is willing to draw.
 *
 * Not a filter but a cap: the number of notes sharing *something* with a note
 * grows with the vault, and past a screenful the answer is a better signal
 * rather than a longer list.
 */
export const RELATED_LIMIT = 20;

/** The most a caller may ask for, whatever it passes: the list is a sidebar. */
const MAX_RELATED_LIMIT = 100;

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
 * two notes share, not links somebody wrote. The table already says so — it
 * holds one entry per target with the number of links as its value — so no
 * list has to be searched for a duplicate; doing that made a note linked from
 * thousands of places cost thousands squared.
 */
export function backlinkIndex(resolved: ResolvedLinks): Map<string, string[]> {
  const backlinks = new Map<string, string[]>();
  for (const [source, targets] of Object.entries(resolved)) {
    for (const target of Object.keys(targets)) {
      const into = backlinks.get(target);
      if (into) into.push(source);
      else backlinks.set(target, [source]);
    }
  }
  return backlinks;
}

/**
 * How many distinct links each file sends and receives, over the whole table.
 *
 * Counted from the table rather than from the notes being ranked, because
 * the table holds more than notes: a canvas links the notes laid out on it,
 * and a canvas is not a note. Counted from the notes alone, a canvas holding
 * four hundred cards was a citer sending no links at all — the rarest thing
 * there is — and made every card on it everybody's closest relative.
 */
export interface LinkDegrees {
  inbound: ReadonlyMap<string, number>;
  outbound: ReadonlyMap<string, number>;
}

export function linkDegrees(resolved: ResolvedLinks): LinkDegrees {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const [source, targets] of Object.entries(resolved)) {
    const names = Object.keys(targets);
    outbound.set(source, names.length);
    for (const target of names) inbound.set(target, (inbound.get(target) ?? 0) + 1);
  }
  return { inbound, outbound };
}

/**
 * A note's tags as the ranking compares them: without the `#`, lowercased,
 * composed, once each.
 *
 * Obsidian matches tags regardless of case, and a tag typed on a Mac arrives
 * with its umlaut decomposed; left as they came, `#Übung` and `#übung` were
 * two tags that never met. Anything that is not a string is dropped — the
 * list is assembled from frontmatter.
 */
export function relatedTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tags = new Set<string>();
  for (const tag of raw) {
    if (typeof tag !== "string") continue;
    const clean = tag.replace(/^#/, "").normalize("NFC").toLowerCase();
    if (clean.length > 0) tags.add(clean);
  }
  return [...tags];
}

/** How the graph is counted, once per query rather than once per candidate. */
interface Frequencies {
  /** How many notes link to each path. */
  inbound: ReadonlyMap<string, number>;
  /** How many links each note sends, which is what makes an index note cheap. */
  outbound: ReadonlyMap<string, number>;
  tags: Map<string, number>;
  folders: Map<string, number>;
  total: number;
}

function countFrequencies(
  notes: readonly RelatedSubject[],
  degrees: LinkDegrees | undefined
): Frequencies {
  const tags = new Map<string, number>();
  const folders = new Map<string, number>();
  let inbound = degrees?.inbound;
  let outbound = degrees?.outbound;

  if (!inbound || !outbound) {
    const countedIn = new Map<string, number>();
    const countedOut = new Map<string, number>();
    for (const note of notes) {
      countedOut.set(note.path, note.links.length);
      for (const link of note.links) countedIn.set(link, (countedIn.get(link) ?? 0) + 1);
    }
    inbound = countedIn;
    outbound = countedOut;
  }

  for (const note of notes) {
    for (const tag of note.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    folders.set(note.folder, (folders.get(note.folder) ?? 0) + 1);
  }

  return { inbound, outbound, tags, folders, total: notes.length };
}

/** What the shared members of two sets are worth together. */
function sharedWeight(
  mine: ReadonlySet<string>,
  theirs: readonly string[],
  frequency: ReadonlyMap<string, number>,
  total: number,
  skip?: string
): { weight: number; count: number } {
  let weight = 0;
  let count = 0;
  for (const item of theirs) {
    // The candidate itself is never the third note two notes share: a note
    // linking to itself would otherwise count its own link to the source's
    // neighbour as something the two have in common.
    if (item === skip || !mine.has(item)) continue;
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
 *
 * `degrees` are the link counts over the whole resolved table; without them
 * the counts are taken from `notes`, which is right only when nothing but
 * notes links anywhere.
 */
export function rankRelated(
  sourcePath: string,
  notes: readonly RelatedSubject[],
  options: { limit?: number; degrees?: LinkDegrees } = {}
): RelatedNote[] {
  const source = notes.find((note) => note.path === sourcePath);
  if (!source) return [];

  const frequencies = countFrequencies(notes, options.degrees);
  const { total } = frequencies;

  // A note that links to itself has not said anything about another note, and
  // left in, its own path became a "shared link" with everything that links it.
  const myLinks = new Set(source.links.filter((path) => path !== sourcePath));
  const myBacklinks = new Set(source.backlinks.filter((path) => path !== sourcePath));
  const myTags = new Set(source.tags);

  const ranked: RelatedNote[] = [];

  for (const note of notes) {
    if (note.path === sourcePath) continue;

    // Each reason with what it added, so the chips can lead with the one that
    // actually decided the place rather than the one that is worth most in
    // general: three rare shared tags can outweigh one common shared link.
    const reasons: { reason: RelatedReason; weight: number }[] = [];
    let score = 0;
    const add = (kind: RelatedReasonKind, count: number, weight: number): void => {
      score += weight;
      reasons.push({ reason: { kind, count }, weight });
    };

    // A link in either direction is one fact, counted once: a pair of notes
    // that link to each other are not twice as related as a pair where one
    // links to the other, they are simply related.
    if (myLinks.has(note.path) || myBacklinks.has(note.path)) add("link", 1, WEIGHTS.link);

    // Both point at the same third note. Weighted by how often that third note
    // is pointed at, so sharing a link to an index everybody links to is worth
    // almost nothing and sharing a link to one particular Objekt is worth a lot.
    const links = sharedWeight(myLinks, note.links, frequencies.inbound, total, note.path);
    if (links.count > 0) add("shared-link", links.count, WEIGHTS["shared-link"] * links.weight);

    // Both are pointed at by the same third note. Weighted by how many links
    // that third note sends: being listed together on a page of four hundred
    // links is a coincidence, being listed together on a page of three is not.
    const cited = sharedWeight(myBacklinks, note.backlinks, frequencies.outbound, total, note.path);
    if (cited.count > 0) add("co-citation", cited.count, WEIGHTS["co-citation"] * cited.weight);

    const tags = sharedWeight(myTags, note.tags, frequencies.tags, total);
    if (tags.count > 0) add("tag", tags.count, WEIGHTS.tag * tags.weight);

    // Sharing nothing else, a note is not related, whatever folder it is in.
    // Let in on the folder alone, a note's whole folder filled the list, and
    // once search by meaning is fused in by rank, a place on this list is worth
    // as much as a place on that one — so a neighbour by filing outranked
    // notes that read alike.
    if (score <= 0) continue;

    // The folder only ever breaks a tie, and only in a folder small enough for
    // sitting in it to have meant something.
    if (note.folder === source.folder) {
      add("folder", 1, WEIGHTS.folder * idf(frequencies.folders.get(note.folder) ?? 0, total));
    }

    reasons.sort((a, b) => b.weight - a.weight);
    ranked.push({
      path: note.path,
      score,
      reasons: reasons.map((entry) => entry.reason),
      modifiedAt: note.modifiedAt
    });
  }

  // The most recently touched of two equally related notes is the one being
  // worked on, and a stable order beats one that shuffles between draws.
  ranked.sort(
    (a, b) => b.score - a.score || b.modifiedAt - a.modifiedAt || comparePaths(a.path, b.path)
  );

  const limit = Math.min(
    Math.max(0, Math.floor(options.limit ?? RELATED_LIMIT)),
    MAX_RELATED_LIMIT
  );
  const top = ranked[0]?.score ?? 0;
  const cutoff = top * RELATED_FLOOR;
  return ranked.filter((note) => note.score >= cutoff).slice(0, limit);
}
