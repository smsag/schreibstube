/**
 * What the explorer's filter matches, and how well.
 *
 * The filter was `name.toLowerCase().includes(query)` on the view, which is the
 * smallest thing that can be called a search and misses in two everyday ways.
 * A note called `Objekt 12.md` whose frontmatter title reads "Villa Seeblick"
 * could not be found by its title, and a German compound could not be found by
 * its head: searching *Vertrag* never offered *Mietvertrag*, because the word
 * being searched for sits at the end of the word that holds it.
 *
 * So a file is matched on the fields that name it — its own name, the title in
 * its frontmatter, its aliases, its tags, the folders above it — each field
 * weighted by how much of a claim a hit there is, and each query token weighted
 * by how rare it is across the vault. A word in every file's path barely moves
 * a score; a word in one file's title decides it.
 *
 * What this is not is a content search. Obsidian's own search reads every note
 * body and has the operators for it; a pane filter that quietly did the same
 * would be slower, worse and redundant. The line is deliberate: this searches
 * what a file is *called*, in every sense a vault gives that word.
 *
 * Pure, so the whole rule is a test rather than something to check by typing
 * into a phone. The view supplies the fields; nothing here knows what Obsidian
 * is.
 */

/**
 * The most words one query is scored against.
 *
 * A filter is typed, and a typed filter is a word or three; this is the bound
 * on what a paste can ask for. Both the work and the memory are files times
 * words — the scoring holds one number per file per word — so a pasted
 * paragraph against a large vault asks for hundreds of megabytes and blocks
 * the app for seconds before answering, and on a phone it does not answer at
 * all. The words past this one are dropped rather than the query refused: a
 * person who pasted by accident wants the filter to keep working, and the
 * first dozen words already say what they were looking for.
 */
export const MAX_QUERY_TOKENS = 12;

/** The words of a query, deduped and bounded. Everything that scores a query
 *  goes through this, so a long one means the same thing wherever it is read. */
export function queryTokens(query: string): string[] {
  return tokenize(query).slice(0, MAX_QUERY_TOKENS);
}

/**
 * Lowercase word tokens, deduped, Unicode-aware.
 *
 * `\p{L}\p{N}` rather than `[a-z0-9]`: this is a German-first plugin, and the
 * ASCII class fragmented every umlaut word — "Ernährung" became "ern" and
 * "hrung", which then cross-matched unrelated text on the stray pieces — while
 * reducing a non-Latin query to no tokens at all, which the empty-query branch
 * reads as "everything matches".
 *
 * NFC first because macOS stores a file name's umlaut decomposed, as "u" plus a
 * combining diaeresis. Without normalising, a file named on a Mac and a query
 * typed on a phone tokenize differently and never meet.
 */
export function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .normalize("NFC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    )
  );
}

/** The word searched for is the word that is there. */
const EXACT = 1;
/** What has been typed so far begins the word: "objek" → "objekt". */
const PREFIX = 0.9;
/** The typed word sits inside a longer one: "vertrag" → "mietvertrag". */
const INFIX = 0.6;
/** The file holds a shorter form of the typed word: "objekte" → "objekt". */
const REVERSE = 0.5;

/**
 * How many characters must be typed before the match is allowed to look inside
 * a word. Below this an infix is noise: three letters occur inside most words
 * of any language, and every file in the vault would answer.
 */
const MIN_INFIX_QUERY = 5;
/** How long a word in the file must be before a shorter-form hit counts at its
 *  start. Keeps "in", "der" and "und" from answering every long query. */
const MIN_REVERSE_HEAD = 4;
/** The same at the end, where the accidents live: "mietvertrag" ends in "trag"
 *  as well as in "vertrag", and only the second is what anyone meant. */
const MIN_REVERSE_TAIL = 5;

/**
 * The strength of the best match for one query token anywhere in one file's
 * tokens, from 1 down to 0.
 *
 * Graded rather than yes-or-no, because the four ways of matching are not
 * equally good and a boolean would let a hit inside a compound outrank the word
 * the person actually typed. Both sides are expected to be `tokenize` output,
 * so nothing is normalised here.
 *
 * No edit distance. Typo tolerance has its own noise budget and its own cost,
 * and is not smuggled in under a threshold nobody chose.
 */
export function matchStrength(fileTokens: readonly string[], queryToken: string): number {
  if (!queryToken) return 0;
  let best = 0;
  for (const token of fileTokens) {
    if (token === queryToken) return EXACT;
    if (token.startsWith(queryToken)) {
      best = Math.max(best, PREFIX);
    } else if (queryToken.length >= MIN_INFIX_QUERY && token.includes(queryToken)) {
      best = Math.max(best, INFIX);
    } else if (
      (token.length >= MIN_REVERSE_HEAD && queryToken.startsWith(token)) ||
      (token.length >= MIN_REVERSE_TAIL && queryToken.endsWith(token))
    ) {
      best = Math.max(best, REVERSE);
    }
  }
  return best;
}

/** The fields a file can be found by, each already tokenized. */
export interface SearchFields {
  /** The file name as the pane shows it, extension included. */
  name: string[];
  /** `title` from the note's frontmatter, when it has one. */
  title: string[];
  /** `aliases` from the note's frontmatter. */
  aliases: string[];
  /** Every tag the note carries, without the `#`. */
  tags: string[];
  /** The folders above the file. The file's own name is not repeated here. */
  path: string[];
  /** What a picture shows, in the words of its description note. Empty for
   *  everything else. */
  description: string[];
}

/** One file as the filter sees it. */
export interface SearchCandidate {
  path: string;
  fields: SearchFields;
}

/**
 * What a hit in each field is worth.
 *
 * The name leads because it is what the person chose and what the row shows.
 * A title is the name a note gives itself and is worth nearly as much; aliases
 * exist to be found by, so they sit level with the title. A tag is a deliberate
 * label but describes a group rather than this file. A picture's description
 * sits below it: every word of it is about this picture, but it is prose, and
 * a word somewhere in two sentences says less than a keyword chosen for it.
 * The path comes last by a
 * distance: every file in a folder shares it, so a folder name that matches
 * says almost nothing about which file inside it was meant — and without the
 * gap, typing a folder's name would bury the one file actually called that.
 */
const FIELD_WEIGHTS: Record<keyof SearchFields, number> = {
  name: 1,
  title: 0.9,
  aliases: 0.9,
  tags: 0.6,
  description: 0.5,
  path: 0.25
};

const FIELD_NAMES = Object.keys(FIELD_WEIGHTS) as (keyof SearchFields)[];

/**
 * Smoothed inverse document frequency: a token in every file still contributes
 * a small baseline rather than dropping to nothing, and a token in one file
 * dominates. The same formula scikit-learn uses for `smooth_idf`.
 */
function idf(documentFrequency: number, total: number): number {
  return Math.log((total + 1) / (documentFrequency + 1)) + 1;
}

/**
 * Results scoring below this share of the best result are dropped.
 *
 * Graded matching makes "scored above zero" too weak a filter on its own: one
 * weak shorter-form hit on a common word would put the whole vault in the list,
 * ranked but useless. The floor is relative and not absolute, because IDF
 * weights move with the size of the vault — an absolute cut-off would mean one
 * thing in a vault of twenty files and another in a vault of twenty thousand.
 */
export const RELEVANCE_FLOOR = 0.15;

/** One file the filter kept. */
export interface SearchHit {
  path: string;
  score: number;
}

/**
 * Which field a token was allowed to match in.
 *
 * `all` is what typing into the box does. The others are what a prefix asks
 * for, and they are the reason the grammar exists: a vault where every Objekt
 * note carries the word "Objekt" in its name cannot be narrowed by typing more
 * of it, only by saying which dimension was meant.
 */
export type SearchScope = "all" | "tags" | "path" | "name";

export interface ParsedQuery {
  scope: SearchScope;
  /** What is left after the prefix, which is what gets tokenized. */
  query: string;
  /** Whether a prefix was actually recognised, so the view can say which
   *  dimension it narrowed to rather than leaving it to be guessed. */
  explicit: boolean;
}

/**
 * The prefixes the box understands.
 *
 * German aliases are listed on purpose: this plugin is used in German, and a
 * person typing into a German interface reaches for `pfad:` before `path:`.
 * A word that is not listed is not a command — it stays in the query as
 * ordinary text, so a note named `todo: Angebot` can still be searched for by
 * typing it.
 */
const SCOPE_PREFIXES: Record<string, SearchScope> = {
  tag: "tags",
  tags: "tags",
  path: "path",
  pfad: "path",
  folder: "path",
  ordner: "path",
  name: "name",
  file: "name",
  datei: "name",
  all: "all",
  alle: "all"
};

/** Split a leading `scope:` off the raw input. */
export function parseSearchScope(raw: string): ParsedQuery {
  const text = (raw ?? "").trim();
  const match = /^([\p{L}]+):\s*(.*)$/su.exec(text);
  const prefix = match?.[1];
  if (prefix !== undefined) {
    const scope = SCOPE_PREFIXES[prefix.toLowerCase()];
    if (scope) return { scope, query: (match?.[2] ?? "").trim(), explicit: true };
  }
  return { scope: "all", query: text, explicit: false };
}

/** The fields a scope searches, in the order they are weighted. */
function fieldsForScope(scope: SearchScope): (keyof SearchFields)[] {
  switch (scope) {
    case "tags":
      return ["tags"];
    case "path":
      return ["path"];
    case "name":
      return ["name"];
    default:
      return FIELD_NAMES;
  }
}

/**
 * Rank every candidate against the query, keeping what clears the floor, best
 * first.
 *
 * The document frequency is counted over the candidates handed in, which is the
 * whole vault as the pane sees it — so a word's rarity is measured against the
 * vault a person is actually looking at rather than against a corpus decided
 * somewhere else.
 *
 * An empty query returns nothing rather than everything: "no filter" is the
 * view's own state and is not expressed by asking this for every file.
 */
export function rankFiles(
  raw: string,
  candidates: readonly SearchCandidate[],
  limit?: number
): SearchHit[] {
  const { scope, query } = parseSearchScope(raw);
  const words = queryTokens(query);
  if (words.length === 0 || candidates.length === 0) return [];

  const fields = fieldsForScope(scope);
  const total = candidates.length;

  // Every file scored against every word once, and the answers kept.
  //
  // A token's rarity is a fact about the whole vault, so it cannot be known
  // until every file has been looked at — but looking again afterwards to
  // apply it would walk the vault twice per keystroke, which on a phone is the
  // difference between a filter and a pause. The strengths are held instead,
  // one number per file and word.
  //
  // The best field wins rather than every field adding up: a note whose name,
  // title and path all say "Objekt" has said one thing three times, and letting
  // it sum would rank repetition above relevance.
  const strengths: number[] = new Array<number>(candidates.length * words.length).fill(0);
  const frequencies = new Array<number>(words.length).fill(0);

  for (let row = 0; row < candidates.length; row++) {
    const candidateFields = candidates[row]?.fields;
    if (!candidateFields) continue;
    for (let column = 0; column < words.length; column++) {
      const token = words[column] ?? "";
      let best = 0;
      for (const field of fields) {
        const strength = matchStrength(candidateFields[field], token);
        if (strength > 0) best = Math.max(best, strength * FIELD_WEIGHTS[field]);
      }
      if (best > 0) {
        strengths[row * words.length + column] = best;
        frequencies[column] = (frequencies[column] ?? 0) + 1;
      }
    }
  }

  const weights = frequencies.map((frequency) => idf(frequency, total));

  const hits: SearchHit[] = [];
  for (let row = 0; row < candidates.length; row++) {
    const path = candidates[row]?.path;
    if (path === undefined) continue;

    let score = 0;
    let matched = 0;
    for (let column = 0; column < words.length; column++) {
      const best = strengths[row * words.length + column] ?? 0;
      if (best === 0) continue;
      matched += 1;
      score += best * (weights[column] ?? 1);
    }
    if (matched === 0) continue;
    // Every word typed is a narrowing, so a file answering all of them beats
    // one answering a single rare word by luck.
    hits.push({ path, score: score * (matched / words.length) });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const top = hits[0]?.score ?? 0;
  const cutoff = top * RELEVANCE_FLOOR;
  const kept = hits.filter((hit) => hit.score >= cutoff);
  return typeof limit === "number" ? kept.slice(0, limit) : kept;
}

/**
 * Whether a piece of text on a row answers the query.
 *
 * For the rows the pane draws that are not vault files — a bookmark, a pinned
 * tag — where there is nothing to rank against and nothing to weigh, so every
 * word typed simply has to be answered.
 *
 * `allowed` is which scopes the row can satisfy at all. A bookmark has no tags
 * and lives at no path, so `tag:` must hide it rather than match it on the word
 * that follows: a filter that ignores the dimension it was given is worse than
 * one that has none.
 */
export function matchesText(
  raw: string,
  text: string,
  allowed: readonly SearchScope[] = ["all", "name"]
): boolean {
  const { scope, query } = parseSearchScope(raw);
  if (query.length === 0) return true;
  if (!allowed.includes(scope)) return false;

  const tokens = tokenize(text);
  return queryTokens(query).every((token) => matchStrength(tokens, token) > 0);
}

/** What a file's fields are built from, in the shape the view can supply
 *  without this module ever importing Obsidian. */
export interface SearchSubject {
  path: string;
  /** The file name with its extension, as the vault stores it. */
  name: string;
  title?: string | null;
  aliases?: readonly string[];
  tags?: readonly string[];
  /** A picture's description, from the note that describes it. */
  description?: string | null;
}

/**
 * Tokenize one file's fields.
 *
 * The extension is dropped from the name: every note would otherwise carry an
 * `md` token, and typing `md` would answer with the whole vault. It stays
 * searchable through `name:`-scoped queries only because the stem keeps
 * whatever else the name holds — a picture called `plan.png` is still found by
 * "plan", and `png` is not a word anybody is looking for a file by.
 *
 * Tokenizing is the expensive half of a keystroke and a file's fields do not
 * change between them, so callers cache this per path and rebuild only when the
 * vault says that file changed.
 */
export function searchFields(subject: SearchSubject): SearchFields {
  const stem = subject.name.replace(/\.[^.]+$/, "");
  const folders = subject.path.split("/").slice(0, -1).join(" ");
  return {
    name: tokenize(stem),
    title: tokenize(subject.title ?? ""),
    aliases: tokenize((subject.aliases ?? []).join(" ")),
    tags: tokenize((subject.tags ?? []).join(" ")),
    path: tokenize(folders),
    description: tokenize(subject.description ?? "")
  };
}
