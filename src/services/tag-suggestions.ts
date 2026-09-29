/**
 * Which tags a note could carry, and where each idea came from.
 *
 * Three places can propose a tag, and they are trusted differently. The notes
 * Recommended puts beside this one already carry tags a person chose, so a tag
 * several of them share is the vault's own answer. A paper states its keywords
 * itself, which is the author's answer. A model reads the text and guesses,
 * which is the only one of the three that can say something nobody wrote down.
 *
 * Whatever the source, a proposal ends in the vault's own vocabulary: a
 * keyword "Machine Learning" becomes the `machine-learning` the vault already
 * uses rather than a second spelling of it, and only a tag nothing in the vault
 * resembles is offered as new — and marked so, because a new tag is a word
 * added to the vault's language, not just to one note.
 */
import { idf } from "./idf";
import type { RelatedReasonKind } from "./related-notes";

/** Where a suggestion came from. The dialog draws one section per origin. */
export type TagOrigin = "vault" | "stated" | "model";

export interface TagSuggestion {
  /** The tag as it would be written: the vault's spelling, or a new one. */
  tag: string;
  /** Nothing in the vault spells it this way or nearly so. */
  isNew: boolean;
  origin: TagOrigin;
  /** For a vault suggestion: how many related notes carry it. */
  carriers?: number;
  /** For a vault suggestion: whether a note linked either way is among them. */
  linked?: boolean;
}

/** The longest tag written from a proposal; anything longer is a sentence. */
export const MAX_TAG_LENGTH = 64;

/** A tag as Obsidian compares it: without the `#`, composed, lowercased. */
export function tagKey(tag: string): string {
  return tag.replace(/^#+/, "").normalize("NFC").toLowerCase();
}

/**
 * A proposal made into a tag Obsidian accepts, or null when nothing is left.
 *
 * Obsidian allows letters, digits, `_`, `-` and `/` for nesting, and refuses a
 * tag of digits alone. Spaces become hyphens, since a keyword is usually a
 * phrase and a tag cannot hold one; everything else is dropped rather than
 * guessed at.
 */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw
    .normalize("NFC")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\p{M}_\-/]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "")
    .replace(/-*\/-*/g, "/");
  if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) return null;
  if (!/[^\p{N}/]/u.test(tag)) return null;
  return tag;
}

/**
 * What two spellings of one idea have in common: case, hyphens, underscores
 * and a plural `s` aside, per level of nesting.
 *
 * The plural is only taken off a word long enough to have one, so `news` and
 * `new` stay two tags.
 */
function looseKey(tag: string): string {
  return tagKey(tag)
    .split("/")
    .map((part) => {
      const flat = part.replace(/[-_\s]/g, "");
      return flat.length > 4 && flat.endsWith("s") && !flat.endsWith("ss")
        ? flat.slice(0, -1)
        : flat;
    })
    .join("/");
}

/** The vault's tags: how many notes carry each, and how it is spelt. */
export interface TagVocabulary {
  /** Notes carrying each tag, by key. */
  counts: ReadonlyMap<string, number>;
  /** The spelling most notes use, by key. */
  spelling: ReadonlyMap<string, string>;
  /** The spelling of each tag by its loose key, the most used one winning. */
  loose: ReadonlyMap<string, string>;
  /** Every note that was counted, for rarity. */
  total: number;
  /** Most of the vault's tags are written in lower case, so a new one should be too. */
  lowercase: boolean;
}

/**
 * Count the vault's tags, one list per note as Obsidian reports it.
 *
 * A note is counted once per tag however often it writes it. When one tag is
 * spelt two ways, the spelling more notes use is the one suggested; a tie goes
 * to the one that sorts first, so the answer does not depend on file order.
 */
export function tagVocabulary(notes: Iterable<readonly string[]>): TagVocabulary {
  const counts = new Map<string, number>();
  const spellings = new Map<string, Map<string, number>>();
  let total = 0;

  for (const tags of notes) {
    total += 1;
    const seen = new Set<string>();
    for (const raw of tags) {
      if (typeof raw !== "string") continue;
      const written = raw.replace(/^#+/, "").normalize("NFC");
      const key = tagKey(written);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const ways = spellings.get(key) ?? new Map<string, number>();
      ways.set(written, (ways.get(written) ?? 0) + 1);
      spellings.set(key, ways);
    }
  }

  const spelling = new Map<string, string>();
  for (const [key, ways] of spellings) {
    const best = [...ways].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (best) spelling.set(key, best[0]);
  }

  const loose = new Map<string, string>();
  const byUse = [...spelling].sort(
    (a, b) => (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0) || (a[0] < b[0] ? -1 : 1)
  );
  for (const [, written] of byUse) {
    const key = looseKey(written);
    if (!loose.has(key)) loose.set(key, written);
  }

  let lower = 0;
  for (const written of spelling.values()) if (written === written.toLowerCase()) lower += 1;
  const lowercase = spelling.size === 0 || lower * 2 >= spelling.size;

  return { counts, spelling, loose, total, lowercase };
}

/**
 * A proposal in the vault's words: its spelling of the same tag when it has
 * one, else a new tag written the way the vault writes its tags.
 */
export function resolveTag(
  raw: unknown,
  vocabulary: TagVocabulary
): { tag: string; isNew: boolean } | null {
  const tag = normalizeTag(raw);
  if (tag === null) return null;
  const exact = vocabulary.spelling.get(tagKey(tag));
  if (exact !== undefined) return { tag: exact, isNew: false };
  const near = vocabulary.loose.get(looseKey(tag));
  if (near !== undefined) return { tag: near, isNew: false };
  return { tag: vocabulary.lowercase ? tag.toLowerCase() : tag, isNew: true };
}

/**
 * Whether a note already says what a tag would say: it carries the tag, or a
 * tag nested under it. A note tagged `projekt/alpha` is already a `projekt`
 * note, the way Obsidian's search finds it; offering the parent would be
 * noise. The other way round is not covered — a more specific tag says more.
 */
export function isCovered(tag: string, carried: ReadonlySet<string>): boolean {
  const key = tagKey(tag);
  if (carried.has(key)) return true;
  for (const own of carried) if (own.startsWith(`${key}/`)) return true;
  return false;
}

/** One note Recommended put beside this one, best first. */
export interface TagNeighbour {
  /** The tags it carries, as Obsidian reports them. */
  tags: readonly string[];
  /** Linked with the note either way: a person said they belong together. */
  linked: boolean;
}

/** How many related notes vote: a panel's worth, whatever length a person chose for it. */
export const TAG_NEIGHBOUR_LIMIT = 20;

/**
 * Recommended is asked for this many entries, so that pictures and
 * conversations among them — which carry no tags — do not leave the vote
 * to a handful of notes.
 */
export const TAG_NEIGHBOUR_REQUEST = TAG_NEIGHBOUR_LIMIT * 3;

/** One entry in Recommended's list, as the vote needs it. */
export interface RecommendedEntry {
  path: string;
  /** Only notes carry tags; a picture or a conversation has none to give. */
  isNote: boolean;
  reasons: readonly { kind: string }[];
}

/** One note that votes: its place on the list is its weight. */
export interface VotingNote {
  path: string;
  /** Linked with the note either way: a person said they belong together. */
  linked: boolean;
}

/**
 * The notes that vote, best first: Recommended's notes, up to the limit.
 * A note is linked when a link either way is among its reasons; a
 * conversation the note was attached to is declared too, but has no tags.
 */
export function votingNotes(
  entries: readonly RecommendedEntry[],
  limit = TAG_NEIGHBOUR_LIMIT
): VotingNote[] {
  const link: RelatedReasonKind = "link";
  return entries
    .filter((entry) => entry.isNote)
    .slice(0, limit)
    .map((entry) => ({
      path: entry.path,
      linked: entry.reasons.some((reason) => reason.kind === link)
    }));
}

/**
 * How much a neighbour's vote is worth by its place on the list.
 *
 * By rank rather than by score, because Recommended's scores come from two
 * rankings on different scales; the smoothing keeps the tenth note from
 * counting for nothing while the first still counts most.
 */
const RANK_SMOOTHING = 5;

/** A tag needs this many related notes carrying it, unless one of them is linked. */
export const MIN_CARRIERS = 2;

/** How many vault suggestions the dialog is given. */
export const VAULT_SUGGESTION_LIMIT = 8;

/** Votes below this share of the best tag's are dropped, as Recommended drops weak notes. */
export const VAULT_SUGGESTION_FLOOR = 0.25;

/**
 * The tags the related notes agree on, best first.
 *
 * Each neighbour votes for the tags it carries, by its place on the list, and
 * a vote is worth more for a tag few notes in the vault carry: a tag every
 * other note has says little about this one. One neighbour alone is not
 * agreement — unless it is a linked note, which a person tied to this one.
 */
export function voteTags(
  neighbours: readonly TagNeighbour[],
  carried: ReadonlySet<string>,
  vocabulary: TagVocabulary,
  options: { limit?: number } = {}
): TagSuggestion[] {
  const votes = new Map<string, { score: number; carriers: number; linked: boolean }>();

  neighbours.forEach((neighbour, rank) => {
    const weight = 1 / (RANK_SMOOTHING + rank);
    const seen = new Set<string>();
    for (const raw of neighbour.tags) {
      if (typeof raw !== "string") continue;
      const key = tagKey(raw);
      if (key.length === 0 || seen.has(key) || isCovered(key, carried)) continue;
      seen.add(key);
      const vote = votes.get(key) ?? { score: 0, carriers: 0, linked: false };
      vote.score += weight * idf(vocabulary.counts.get(key) ?? 1, vocabulary.total);
      vote.carriers += 1;
      vote.linked ||= neighbour.linked;
      votes.set(key, vote);
    }
  });

  const agreed = [...votes]
    .filter(([, vote]) => vote.carriers >= MIN_CARRIERS || vote.linked)
    .sort((a, b) => b[1].score - a[1].score || (a[0] < b[0] ? -1 : 1));

  const top = agreed[0]?.[1].score ?? 0;
  return agreed
    .filter(([, vote]) => vote.score >= top * VAULT_SUGGESTION_FLOOR)
    .slice(0, options.limit ?? VAULT_SUGGESTION_LIMIT)
    .map(([key, vote]) => ({
      tag: vocabulary.spelling.get(key) ?? key,
      isNew: false,
      origin: "vault" as const,
      carriers: vote.carriers,
      linked: vote.linked
    }));
}

/**
 * Proposals from the paper or the model as suggestions: in the vault's words,
 * without what the note already carries, and without what an earlier section
 * already offers — a tag is shown once, where it was found first.
 *
 * `offered` is filled as it goes, so sections are asked in the order they are
 * drawn.
 */
export function suggestionsFrom(
  origin: Exclude<TagOrigin, "vault">,
  proposals: readonly unknown[],
  carried: ReadonlySet<string>,
  vocabulary: TagVocabulary,
  offered: Set<string>
): TagSuggestion[] {
  const suggestions: TagSuggestion[] = [];
  for (const proposal of proposals) {
    const resolved = resolveTag(proposal, vocabulary);
    if (!resolved) continue;
    const key = tagKey(resolved.tag);
    if (offered.has(key) || isCovered(key, carried)) continue;
    offered.add(key);
    suggestions.push({ ...resolved, origin });
  }
  return suggestions;
}
