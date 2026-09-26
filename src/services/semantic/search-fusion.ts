import { parseSearchScope } from "../file-search";

/**
 * One list from two rankings: what a file is called, and what it is about.
 *
 * The Explorer filter ranks by name, title, aliases, tags, path and a picture's
 * description; the semantic index ranks notes by meaning. Neither alone is the
 * answer. Meaning finds the note about the kitchen that never says "Küche"; the
 * words find "Objekt 12" and "Seestraße 4", which a sentence model scores no
 * better than any other number. Their scores are on different scales, so they
 * are fused by rank, not by score: each list contributes `1 / (k + rank)` for
 * every file it holds, and a file both lists hold rises above either alone.
 *
 * Reciprocal rank fusion, with the k its authors found to work across tasks.
 * The keyword list keeps a small edge for its first place, so a file named
 * exactly for what was typed is not overtaken by a note that merely means it.
 */

/** The constant in `1 / (k + rank)`: how much the top of each list is favoured. */
export const FUSION_K = 60;

/** The keyword list's first place gets this much more, so an exact name wins. */
export const KEYWORD_TOP_BONUS = 1 / FUSION_K;

export interface FusedHit {
  path: string;
  score: number;
  /** Which lists found it — for the row to say why it is there. */
  by: ("words" | "meaning")[];
}

/**
 * Fuse a keyword ranking with a semantic ranking, both best first.
 *
 * `semantic` may name files the keyword list never saw (that is the point) and
 * may be empty (the index is off or not ready), in which case the keyword order
 * comes back unchanged.
 */
export function fuseRankings(
  keyword: readonly { path: string }[],
  semantic: readonly { path: string }[],
  limit?: number
): FusedHit[] {
  const fused = new Map<string, FusedHit>();
  const add = (path: string, rank: number, by: "words" | "meaning", bonus = 0): void => {
    const hit = fused.get(path) ?? { path, score: 0, by: [] };
    hit.score += 1 / (FUSION_K + rank) + bonus;
    if (!hit.by.includes(by)) hit.by.push(by);
    fused.set(path, hit);
  };

  keyword.forEach((hit, i) => add(hit.path, i + 1, "words", i === 0 ? KEYWORD_TOP_BONUS : 0));
  semantic.forEach((hit, i) => add(hit.path, i + 1, "meaning"));

  const ranked = [...fused.values()].sort(
    (a, b) => b.score - a.score || a.path.localeCompare(b.path)
  );
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}

/** Shorter than this, a query is a prefix being typed, not something with a meaning. */
export const MEANING_MIN_CHARS = 3;

/**
 * The text to search by meaning for, or null when meaning has nothing to add.
 *
 * A `tag:` or `path:` prefix asks for one dimension on purpose; answering it
 * with notes that merely mean the same would override what was asked. `all:`
 * is the plain box said out loud, so it still counts.
 */
export function meaningQuery(raw: string): string | null {
  const parsed = parseSearchScope(raw);
  if (parsed.explicit && parsed.scope !== "all") return null;
  return parsed.query.length >= MEANING_MIN_CHARS ? parsed.query : null;
}

/**
 * The rows the meaning hits stand for, best first, each once.
 *
 * The index holds notes, and some notes are not rows: a description note is
 * shown as the picture it describes, which is the point of describing it — the
 * picture is what someone searching "Balkon mit Blick auf den See" wants.
 * `row` names the path a hit is shown as, or null to leave it out.
 */
export function meaningRows(
  hits: readonly { path: string }[],
  row: (path: string) => string | null
): { path: string }[] {
  const seen = new Set<string>();
  const out: { path: string }[] = [];
  for (const hit of hits) {
    const path = row(hit.path);
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    out.push({ path });
  }
  return out;
}
