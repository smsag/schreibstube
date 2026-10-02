/**
 * What to recommend beside the open note: the notes its links point to, and
 * the notes that mean the same, in one list.
 *
 * The link graph says what a person wrote down belongs together (`related-
 * notes`); the index says what reads alike. Either alone misses half: links
 * never find the note about the same kitchen nobody linked, and meaning ranks
 * a note the person linked on purpose below prose that merely sounds similar.
 * Their scores are on different scales, so they are fused by rank, as the
 * Explorer filter fuses its two lists, and a note both find rises above either.
 * A direct link keeps its lead: it is a person saying so.
 *
 * Every card keeps its reasons, "similar in meaning" among them, so it can
 * say why it is there.
 *
 * Notes, pictures and the sources' items are ranked together, not in
 * sections of their kind: the panel was a picture strip, then notes, then
 * conversations, so the most relevant thing could sit under a heading below
 * the ten least relevant of another kind. One list, by relevance, a length a
 * person chose.
 */
import type { RelatedReason } from "../related-notes";
import { FUSION_K } from "./search-fusion";
import { relevance } from "./semantic-api";

export type RecommendReason =
  | RelatedReason
  /** Read alike, with the cosine that said so, so the entry can show it. */
  | { kind: "meaning"; count: 1; similarity: number }
  /** An item the note was attached to as context: said by a person, like a link. */
  | { kind: "attached"; count: 1 };

export interface RecommendedNote {
  path: string;
  score: number;
  /** Strongest first: a link, then meaning, then what the graph shares. */
  reasons: RecommendReason[];
}

/** A direct link's lead over a note that is merely first by meaning. */
const LINK_BONUS = 1 / FUSION_K;

const ORDER: Record<RecommendReason["kind"], number> = {
  link: 0,
  attached: 0,
  meaning: 1,
  "shared-link": 2,
  "co-citation": 3,
  tag: 4,
  folder: 5
};

/**
 * The link graph with each description note standing for its picture, as it
 * does in the meaning ranking and in the Explorer. The note's links and tags
 * are what relate the picture, but what belongs beside a note is the picture,
 * not the words written about it; listed as a note, it stood beside the very
 * picture it describes. Two notes describing one picture make one entry, where
 * the first stood, each kind of reason counted at the larger of the two.
 */
export function foldDescriptions<R extends { kind: string; count: number }>(
  graph: readonly { path: string; reasons: readonly R[] }[],
  pictureOf: (path: string) => string | null
): { path: string; reasons: R[]; picture: boolean }[] {
  const folded = new Map<string, { path: string; reasons: R[]; picture: boolean }>();
  for (const entry of graph) {
    const picture = pictureOf(entry.path);
    const path = picture ?? entry.path;
    const known = folded.get(path);
    if (!known) {
      const reasons = entry.reasons.map((reason) => ({ ...reason }));
      folded.set(path, { path, reasons, picture: picture !== null });
      continue;
    }
    for (const reason of entry.reasons) {
      const same = known.reasons.find((r) => r.kind === reason.kind);
      if (!same) known.reasons.push({ ...reason });
      else if (reason.count > same.count) same.count = reason.count;
    }
  }
  return [...folded.values()];
}

/**
 * The entries without the pictures the open note shows itself.
 *
 * A picture's description links the articles it is in (`schreibstubeArticles`)
 * and the picture it describes, so for an article every picture in it came
 * back as a backlink and a shared link — the strongest things the graph
 * knows — and stood at the top of its recommendations. What is already on
 * the page is not something to be shown beside it. `shown` is every file the
 * note links or embeds; a note it links stays, since reaching a linked note
 * from beside the text is what a recommendation is for.
 */
export function withoutPicturesShown<T extends { path: string }>(
  entries: readonly T[],
  isPicture: (entry: T) => boolean,
  shown: ReadonlySet<string>
): T[] {
  return entries.filter((entry) => !(isPicture(entry) && shown.has(entry.path)));
}

/** Said by a person rather than inferred: a link, or a note attached. */
function isDeclared(reason: RecommendReason): boolean {
  return reason.kind === "link" || reason.kind === "attached";
}

/**
 * The graph's list with the conversations the note was attached to, placed
 * among the direct links: after the last entry a person linked, before what
 * the graph merely inferred. Attaching a note to a conversation says what
 * writing a link says, and a conversation had no other way onto this side of
 * the ranking — it could only ever be found by meaning.
 */
export function withAttached(
  graph: readonly { path: string; reasons: readonly RecommendReason[] }[],
  attached: readonly string[]
): { path: string; reasons: readonly RecommendReason[] }[] {
  const known = new Set(graph.map((entry) => entry.path));
  const added = attached
    .filter((key) => !known.has(key))
    .map((path) => ({ path, reasons: [{ kind: "attached", count: 1 } as const] }));
  if (added.length === 0) return [...graph];
  let at = 0;
  graph.forEach((entry, i) => {
    if (entry.reasons.some(isDeclared)) at = i + 1;
  });
  return [...graph.slice(0, at), ...added, ...graph.slice(at)];
}

export function recommendNotes(
  graph: readonly { path: string; reasons: readonly RecommendReason[] }[],
  meaning: readonly { path: string; score: number }[],
  limit: number
): RecommendedNote[] {
  const byPath = new Map<string, RecommendedNote>();
  const entry = (path: string): RecommendedNote => {
    let hit = byPath.get(path);
    if (!hit) {
      hit = { path, score: 0, reasons: [] };
      byPath.set(path, hit);
    }
    return hit;
  };
  graph.forEach((note, i) => {
    const hit = entry(note.path);
    hit.score += 1 / (FUSION_K + i + 1);
    if (note.reasons.some(isDeclared)) hit.score += LINK_BONUS;
    hit.reasons.push(...note.reasons);
  });
  meaning.forEach((note, i) => {
    const hit = entry(note.path);
    hit.score += 1 / (FUSION_K + i + 1);
    hit.reasons.push({ kind: "meaning", count: 1, similarity: note.score });
  });
  for (const hit of byPath.values()) hit.reasons.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  return [...byPath.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/**
 * One ranking by meaning across the vault and the sources' items.
 *
 * Ordered by how far each clears the floor measured for its kind — note to
 * note, note to item — since those floors differ and a raw similarity ranks
 * them unlike: a note just past its floor would stand above an item well past
 * its own. The similarity each entry keeps is still the raw one, which is
 * what a card shows. A tie keeps the vault first, the thing the person wrote.
 */
export function meaningOrder(
  notes: { hits: readonly { key: string; score: number }[]; floor: number },
  items: { hits: readonly { key: string; score: number }[]; floor: number }
): { path: string; score: number }[] {
  const all = [
    ...notes.hits.map((hit, i) => ({ ...hit, rank: relevance(hit.score, notes.floor), order: i })),
    ...items.hits.map((hit, i) => ({
      ...hit,
      rank: relevance(hit.score, items.floor),
      order: notes.hits.length + i
    }))
  ];
  const seen = new Set<string>();
  const out: { path: string; score: number }[] = [];
  for (const hit of all.sort((a, b) => b.rank - a.rank || a.order - b.order)) {
    if (seen.has(hit.key)) continue;
    seen.add(hit.key);
    out.push({ path: hit.key, score: hit.score });
  }
  return out;
}

/** How strongly an entry belongs with the note, in words a person can weigh. */
export type Relevance = "high" | "medium" | "low";

/** The similarity levels an entry is read against: the model's measured
 *  floors for the kind of entry it is. */
export interface RelevanceFloors {
  balanced: number;
  strict: number;
}

/**
 * How relevant an entry is, from what put it on the list.
 *
 * Not from its place and not from the fused score: both are relative — the
 * first entry is first however weak the list is, and a rank-fused score has no
 * unit a person could read. The evidence is absolute. A link or an attached
 * note is a person saying so; a shared link or a common citer is strong
 * inference; a shared tag is a hint; similarity is read against the floors
 * the model was measured at, so "high" means past the strict floor, not a
 * number picked here. The folder adds nothing: it only breaks ties.
 */
export function relevanceOf(
  reasons: readonly RecommendReason[],
  floors: RelevanceFloors
): Relevance {
  let points = 0;
  for (const reason of reasons) {
    switch (reason.kind) {
      case "link":
      case "attached":
        points += 3;
        break;
      case "shared-link":
      case "co-citation":
        points += 2;
        break;
      case "tag":
        points += 1;
        break;
      case "meaning":
        points +=
          reason.similarity >= floors.strict
            ? 3
            : reason.similarity >= (floors.balanced + floors.strict) / 2
              ? 2
              : 1;
        break;
      default:
        break;
    }
  }
  return points >= 3 ? "high" : points === 2 ? "medium" : "low";
}

/** Similarity as a person reads it: a whole percentage. */
export function similarityPercent(similarity: number): number {
  return Math.round(Math.min(1, Math.max(0, similarity)) * 100);
}
