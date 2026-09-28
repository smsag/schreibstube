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
 * Notes, pictures and Pythia's conversations are ranked together, not in
 * sections of their kind: the panel was a picture strip, then notes, then
 * conversations, so the most relevant thing could sit under a heading below
 * the ten least relevant of another kind. One list, by relevance, a length a
 * person chose.
 */
import type { RelatedReason } from "../related-notes";
import { FUSION_K } from "./search-fusion";

export type RecommendReason =
  | RelatedReason
  /** Read alike, with the cosine that said so, so the entry can show it. */
  | { kind: "meaning"; count: 1; similarity: number }
  /** A conversation the note was attached to as context: said by a person,
   *  like a link. */
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
 * The key a conversation takes in the fused ranking. A colon cannot occur in
 * an Obsidian file name, so no vault path can ever be mistaken for one.
 */
const CONVERSATION_PREFIX = "conversation:";

export function conversationKey(id: string): string {
  return `${CONVERSATION_PREFIX}${id}`;
}

/** The conversation a ranking key names, or null for a vault path. */
export function conversationIdOf(key: string): string | null {
  return key.startsWith(CONVERSATION_PREFIX) ? key.slice(CONVERSATION_PREFIX.length) : null;
}

/**
 * One ranking by meaning across the vault and Pythia's conversations.
 *
 * Their scores compare: the same model, the same comparison of the open
 * note's passages against theirs, and the same floor to clear. A tie keeps
 * the vault first, the thing the person wrote.
 */
export function meaningOrder(
  notes: readonly { key: string; score: number }[],
  conversations: readonly { id: string; score: number }[]
): { path: string; score: number }[] {
  const all = [
    ...notes.map((hit, i) => ({ key: hit.key, score: hit.score, order: i })),
    ...conversations.map((hit, i) => ({
      key: conversationKey(hit.id),
      score: hit.score,
      order: notes.length + i
    }))
  ];
  const seen = new Set<string>();
  const out: { path: string; score: number }[] = [];
  for (const hit of all.sort((a, b) => b.score - a.score || a.order - b.order)) {
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
