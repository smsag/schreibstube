/**
 * Which of a note's stored passages rank the rest of the index: the ones
 * around the place the person is reading or writing, not the note's opening.
 *
 * A note ranks by at most `MAX_SOURCE_CHUNKS` of its passages, because every
 * one of them is compared with every row on the UI thread, a phone's too. They
 * were always the first ones, so under a chapter of twenty pages the list was
 * about its first page. The same number of passages, taken from where the
 * person is, costs the same and answers for what they are looking at.
 *
 * The stored vectors belong to the version of the note the index last read,
 * and the note being written has moved on since. So passages are found by
 * their text, not their position: the note as it is now is cut the way the
 * index cuts it, the passages nearest the place are hashed, and the stored
 * passages with those hashes are the ones taken. A passage written since has
 * no stored vector and is passed over for the nearest one that has.
 *
 * Pure: the caller hands in the note's text and the place, and the index's
 * vectors and hashes.
 */
import { passageHash } from "./embedding-index";
import { chunkByHeadings } from "./heading-chunks";
import { vaultNoteChunks } from "./vault-retrieval";
import { MAX_SOURCE_CHUNKS } from "./vector-math";
import { plainNoteText } from "../note-text";

/** Where in a note to rank from: a zero-based line, or its end. */
export type FocusPoint = number | "end";

/** What to fall back to when the stored passages cannot be told apart. */
export type FocusFallback = "opening" | "end";

/**
 * The hash of each passage of the note as it is now, nearest to `at` first.
 *
 * "Nearest" is by passage: those holding the section `at` is in come first,
 * then their neighbours outwards, one before and one after in turn, so a
 * place in the middle of a note draws on both sides of it. A section the
 * passages no longer reach — past the most a note is embedded as — counts as
 * the last of them.
 */
export function focusHashes(markdown: string, at: FocusPoint, maxChars: number): number[] {
  const passages = vaultNoteChunks(markdown, maxChars);
  if (passages.length === 0) return [];

  const [lo, hi] = at === "end" ? [passages.length - 1, passages.length - 1] : around(markdown, at);
  const order: number[] = [];
  for (let i = lo; i <= hi; i++) order.push(i);
  for (let step = 1; order.length < passages.length; step++) {
    if (lo - step >= 0) order.push(lo - step);
    if (hi + step < passages.length) order.push(hi + step);
  }
  return order.map((i) => passageHash(passages[i] ?? ""));

  /** The first and last passage holding the section `line` is in. */
  function around(text: string, line: number): [number, number] {
    const last = passages.length - 1;
    const sections = sectionsOf(text);
    const prefix = text
      .split("\n")
      .slice(0, Math.max(0, line) + 1)
      .join("\n");
    const section = sections[Math.max(0, sectionsOf(prefix).length - 1)];
    if (section === undefined) return [last, last];
    // A passage is a window of a long section or several short ones together,
    // so it lies inside the section or holds the whole of it.
    const holding = passages.flatMap((p, i) =>
      section.includes(p) || p.includes(section) ? [i] : []
    );
    const first = holding[0];
    const final = holding[holding.length - 1];
    return first === undefined || final === undefined ? [last, last] : [first, final];
  }
}

/** A note's sections as the index cuts them, before short ones are joined. */
function sectionsOf(markdown: string): string[] {
  return chunkByHeadings(plainNoteText(markdown))
    .map((chunk) => chunk.text.trim())
    .filter(Boolean);
}

/**
 * The stored vectors to rank from: those whose passages come first in
 * `wanted`, at most `max` of them, in the note's order.
 *
 * Without stored hashes, or when none of them is wanted any more, the place
 * cannot be found among the vectors, and they are taken by position: from the
 * opening, as the ranking always did, or from the end.
 */
export function choosePassages<T>(
  chunks: readonly T[],
  stored: ArrayLike<number> | undefined,
  wanted: readonly number[],
  fallback: FocusFallback,
  max: number = MAX_SOURCE_CHUNKS
): T[] {
  const byPosition = (): T[] =>
    fallback === "end" ? chunks.slice(Math.max(0, chunks.length - max)) : chunks.slice(0, max);
  if (!stored || stored.length !== chunks.length || wanted.length === 0) return byPosition();

  const where = new Map<number, number[]>();
  for (let i = 0; i < stored.length; i++) {
    const hash = stored[i] ?? 0;
    const known = where.get(hash);
    if (known) known.push(i);
    else where.set(hash, [i]);
  }
  const picked = new Set<number>();
  for (const hash of wanted) {
    if (picked.size >= max) break;
    const next = where.get(hash)?.find((i) => !picked.has(i));
    if (next !== undefined) picked.add(next);
  }
  if (picked.size === 0) return byPosition();
  return [...picked]
    .sort((a, b) => a - b)
    .flatMap((i) => (chunks[i] === undefined ? [] : [chunks[i]]));
}

/**
 * Which section of a note `line` is in, as a number: what a list ranked for
 * the place keeps its answer under, so moving within a section asks nothing.
 */
export function sectionKey(markdown: string, line: number): number {
  return sectionsOf(
    markdown
      .split("\n")
      .slice(0, Math.max(0, line) + 1)
      .join("\n")
  ).length;
}
