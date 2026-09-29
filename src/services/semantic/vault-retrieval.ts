// What a vault note is to the index (Pythia ADR-116): the passages it is
// embedded as, and the frontmatter that keeps it out. Pure, so both are tested
// without a model; scoring lives in `VaultIndexService`.

import { chunkByHeadings } from "./heading-chunks";
import { plainNoteText } from "../note-text";

/** A scored note from a vault-retrieval query. */
export interface RetrievedNote {
  /** Vault path of the note (the index id). */
  id: string;
  /** Best chunk-to-query cosine, ≈ [-1, 1]. */
  score: number;
}

/**
 * The most passages one note is embedded as.
 *
 * Embedding time is linear in passages, and a vault's build time was decided by
 * its few longest notes: a pasted mail thread or an exported chat of a few
 * hundred thousand characters cost more than the rest of the vault together,
 * and ran past the request deadline so it was never finished at all. At the
 * default model's ~420 characters a passage this is about forty thousand
 * characters — twenty pages — which says what a note is about many times over.
 */
export const MAX_CHUNKS_PER_NOTE = 96;

/** How much of a passage the next one repeats when a long section is cut. */
const OVERLAP_SHARE = 0.15;
/** A cut looks back this far for a space before it gives up and cuts mid-word. */
const MIN_CUT_SHARE = 0.6;

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\n" || ch === "\t";
}

/**
 * Cut one long section into passages of at most `maxChars`, at spaces, each
 * repeating the end of the one before.
 *
 * A hard cut every `maxChars` split words in two — two half-words that mean
 * nothing, embedded into two passages — and a phrase that straddled the cut
 * was in neither of them whole. Cutting at a space and overlapping by a few
 * words keeps every sentence of reasonable length whole in at least one
 * passage.
 */
function windows(text: string, maxChars: number): string[] {
  const out: string[] = [];
  const overlap = Math.floor(maxChars * OVERLAP_SHARE);
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const floor = start + Math.floor(maxChars * MIN_CUT_SHARE);
      let cut = end;
      while (cut > floor && !isSpace(text[cut])) cut--;
      if (cut > floor) end = cut;
    }
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= text.length) break;
    // Back up by the overlap, then forward to the start of a word.
    let next = end - overlap;
    while (next < end && !isSpace(text[next - 1])) next++;
    start = next > start ? next : end;
  }
  return out;
}

/**
 * The passages a vault note is embedded as.
 *
 * Three choices, each of which cut the time a build took. The note is read as
 * prose first (`plainNoteText`): no frontmatter, code, URLs or encoded data.
 * Sections shorter than a passage are merged with their neighbours — a note of
 * thirty short headings used to be thirty embeds of a line each, where five
 * passages carry the same text. And a note stops at `MAX_CHUNKS_PER_NOTE`.
 * Long sections are cut at spaces with an overlap (`windows`).
 *
 * Deterministic, which the content-hash reuse relies on: the same note always
 * yields the same passages.
 */
export function vaultNoteChunks(markdown: string, maxChars = 500): string[] {
  const text = plainNoteText(markdown);
  const sections = chunkByHeadings(text)
    .map((c) => c.text.trim())
    .filter(Boolean);
  const source = sections.length > 0 ? sections : [text.trim()].filter(Boolean);

  const merged: string[] = [];
  let pending = "";
  for (const section of source) {
    if (pending && pending.length + 2 + section.length <= maxChars) {
      pending = `${pending}\n\n${section}`;
    } else {
      if (pending) merged.push(pending);
      pending = section;
    }
  }
  if (pending) merged.push(pending);

  const chunks: string[] = [];
  for (const piece of merged) {
    for (const chunk of piece.length <= maxChars ? [piece] : windows(piece, maxChars)) {
      chunks.push(chunk);
      if (chunks.length >= MAX_CHUNKS_PER_NOTE) return chunks;
    }
  }
  return chunks;
}

/**
 * Whether a note's frontmatter opts it out of the vault index (Pythia ADR-183).
 *
 * `pythia: false` keeps a note out of the index entirely, so its text never
 * reaches a cloud model as auto-retrieved context. Folder scope already answers
 * "which parts of the vault", but a single sensitive note inside an otherwise
 * indexed folder had no answer at all — and data minimisation wants the smallest
 * unit to be excludable, not just the largest.
 *
 * Only an explicit `false` (or the string "false") opts out. Anything else,
 * including a missing key or an unreadable cache, indexes as before — a
 * frontmatter typo must not silently drop a note out of retrieval.
 */
export function isIndexingOptedOut(frontmatter: unknown): boolean {
  if (!frontmatter || typeof frontmatter !== "object") return false;
  const value = (frontmatter as Record<string, unknown>).pythia;
  return value === false || value === "false";
}

/** Frontmatter a note carries to stay out of Schreibstube's index. */
export const OPT_OUT_KEY = "schreibstubeIndex";

/**
 * Whether a note's frontmatter keeps it out of the index: Pythia's key or
 * Schreibstube's, each read the same way — an explicit `false`, or the string
 * "false" a hand-edited or synced property often turns into. The two were read
 * differently, so `schreibstubeIndex: "false"` indexed the note it meant to
 * keep out.
 */
export function optedOut(frontmatter: unknown): boolean {
  if (isIndexingOptedOut(frontmatter)) return true;
  if (!frontmatter || typeof frontmatter !== "object") return false;
  const value = (frontmatter as Record<string, unknown>)[OPT_OUT_KEY];
  return value === false || value === "false";
}
