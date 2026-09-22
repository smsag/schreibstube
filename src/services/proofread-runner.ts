/**
 * Turns a document into review-queue suggestions.
 *
 * Two producers share one output shape. The glossary scan is local, immediate
 * and free. The model pass chunks the note, sends each chunk, and derives edits
 * from a local diff of the rewrite, so the offsets on every card come from the
 * document rather than from the response.
 *
 * `requestUrl` cannot stream, so progressive feedback comes from chunking: each
 * chunk that resolves reports its suggestions through `onChunk` while the rest
 * are still in flight.
 */

import type { GlossaryHit, GlossaryMatcher } from "./glossary-matcher";
import {
  placeholdersIntact,
  restorePlaceholders,
  segmentMarkdown,
  type ProseBlock
} from "./markdown-segments";
import { createSuggestion, type Suggestion, type SuggestionCategory } from "./suggestion";
import { diffToEdits } from "./word-diff";

export interface CancelToken {
  cancelled: boolean;
}

export function createCancelToken(): CancelToken {
  return { cancelled: false };
}

/** Sends one chunk and returns each block's rewrite, keyed by block id. */
export type ChunkSender = (
  blocks: ProseBlock[],
  token: CancelToken
) => Promise<Map<string, string>>;

export interface ProofreadOptions {
  /** Characters of masked text per request. */
  chunkChars: number;
  /** Requests in flight at once. */
  concurrency: number;
}

export interface ProofreadProgress {
  completedChunks: number;
  totalChunks: number;
  suggestions: Suggestion[];
}

export interface ProofreadResult {
  suggestions: Suggestion[];
  /** Blocks whose rewrite was rejected because a protected span went missing. */
  rejectedBlocks: number;
  failedChunks: number;
  cancelled: boolean;
}

/** Scan a document against the selected glossaries. No network, no API key. */
export function scanGlossary(text: string, matcher: GlossaryMatcher): Suggestion[] {
  if (matcher.isEmpty()) return [];

  const { blocks } = segmentMarkdown(text);
  const suggestions: Suggestion[] = [];

  for (const block of blocks) {
    for (const hit of matcher.findHits(block.text, block.protectedRanges)) {
      suggestions.push(suggestionFromHit(block, hit));
    }
  }

  return suggestions.sort((a, b) => a.from - b.from);
}

function suggestionFromHit(block: ProseBlock, hit: GlossaryHit): Suggestion {
  const category: SuggestionCategory =
    hit.kind === "capitalization" ? "capitalization" : "terminology";

  return createSuggestion({
    kind: "replace",
    source: "glossary",
    category,
    severity: hit.severity,
    from: block.from + hit.from,
    to: block.from + hit.to,
    original: hit.matchedText,
    // An existence rule has nothing to propose, so accepting it would be a
    // no-op. The card offers no Accept, and the replacement stays the original.
    replacement: hit.replacement ?? hit.matchedText,
    note: buildHitNote(hit),
    needsReview: hit.inflected && hit.replacement !== null
  });
}

function buildHitNote(hit: GlossaryHit): string {
  if (hit.note) return hit.note;
  switch (hit.kind) {
    case "substitution":
      return `"${hit.matchedText}" ist nicht mehr die bevorzugte Benennung.`;
    case "capitalization":
      return `Schreibweise laut Glossar: "${hit.replacement}".`;
    default:
      return hit.status === "superseded"
        ? `"${hit.matchedText}" ist überholt — bitte selbst entscheiden.`
        : `"${hit.matchedText}" sollte vermieden werden.`;
  }
}

/** True when a hit only flags and has nothing to apply. */
export function isFlagOnly(suggestion: Suggestion): boolean {
  return suggestion.replacement === suggestion.original;
}

/** Group blocks into requests under a character budget. A block larger than the
 *  budget still gets its own chunk rather than being split mid-sentence. */
export function chunkBlocks(blocks: ProseBlock[], chunkChars: number): ProseBlock[][] {
  const chunks: ProseBlock[][] = [];
  let current: ProseBlock[] = [];
  let size = 0;

  for (const block of blocks) {
    const length = block.masked.length;
    if (current.length > 0 && size + length > chunkChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += length;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Run the model pass over a document and collect suggestions. */
export async function runProofread(
  text: string,
  send: ChunkSender,
  options: ProofreadOptions,
  token: CancelToken,
  onProgress?: (progress: ProofreadProgress) => void
): Promise<ProofreadResult> {
  const { blocks, placeholders } = segmentMarkdown(text);
  const chunks = chunkBlocks(blocks, options.chunkChars);

  const suggestions: Suggestion[] = [];
  let rejectedBlocks = 0;
  let failedChunks = 0;
  let completedChunks = 0;
  let nextChunk = 0;

  const report = (): void =>
    onProgress?.({
      completedChunks,
      totalChunks: chunks.length,
      suggestions: [...suggestions].sort((a, b) => a.from - b.from)
    });

  const worker = async (): Promise<void> => {
    while (!token.cancelled) {
      const chunk = chunks[nextChunk];
      if (chunk === undefined) return;
      nextChunk += 1;

      let rewrites: Map<string, string>;
      try {
        rewrites = await send(chunk, token);
      } catch {
        // One chunk failing must not lose the chunks that succeeded, so the
        // failure is counted and reported rather than thrown. It still counts
        // as progress: a run whose last chunk failed would otherwise leave the
        // panel showing the chunk before it, as though it had never finished.
        failedChunks += 1;
        completedChunks += 1;
        report();
        continue;
      }

      if (token.cancelled) return;

      const produced: Suggestion[] = [];
      for (const block of chunk) {
        const rewritten = rewrites.get(block.id);
        if (rewritten === undefined) continue;

        if (!placeholdersIntact(block.masked, rewritten)) {
          rejectedBlocks += 1;
          continue;
        }

        produced.push(...suggestionsForBlock(text, block, rewritten, placeholders));
      }

      suggestions.push(...produced);
      completedChunks += 1;
      report();
    }
  };

  const workers = Array.from(
    { length: Math.max(1, Math.min(options.concurrency, chunks.length)) },
    () => worker()
  );
  await Promise.all(workers);

  return {
    suggestions: suggestions.sort((a, b) => a.from - b.from),
    rejectedBlocks,
    failedChunks,
    cancelled: token.cancelled
  };
}

function suggestionsForBlock(
  docText: string,
  block: ProseBlock,
  maskedRewrite: string,
  placeholders: Map<string, string>
): Suggestion[] {
  // Restoring first means the diff runs in the block's own coordinates, so each
  // edit offset is directly usable against the document.
  const rewritten = restorePlaceholders(maskedRewrite, placeholders);

  return diffToEdits(block.text, rewritten).map((edit) =>
    createSuggestion(
      {
        kind: editKind(edit.before, edit.after),
        source: "llm",
        category: categorize(edit.before, edit.after),
        severity: "suggestion",
        from: block.from + edit.from,
        to: block.from + edit.to,
        original: edit.before,
        replacement: edit.after,
        note: ""
      },
      // The document's coordinates, not the block's: an edit at the very start
      // of a block has nothing before it inside that block, and taking the
      // slice there recorded no anchor at all — which left the card unplaceable
      // against the very text it had just been read from.
      docText.slice(0, block.from + edit.from)
    )
  );
}

function editKind(before: string, after: string): Suggestion["kind"] {
  if (before.trim().length === 0) return "insert";
  if (after.trim().length === 0) return "delete";
  return "replace";
}

/** A rough label for the card badge. The model is not asked to classify, since
 *  a wrong label on a correct edit is worse than a generic one. */
function categorize(before: string, after: string): SuggestionCategory {
  const beforeWords = before.trim().split(/\s+/u).filter(Boolean);
  const afterWords = after.trim().split(/\s+/u).filter(Boolean);

  if (beforeWords.length === 0 || afterWords.length === 0) {
    return "punctuation";
  }

  if (beforeWords.length === 1 && afterWords.length === 1) {
    const a = beforeWords[0] ?? "";
    const b = afterWords[0] ?? "";
    if (a.toLowerCase() === b.toLowerCase()) return "capitalization";
    if (stripPunctuation(a) === stripPunctuation(b)) return "punctuation";
    if (isNearMiss(a, b)) return "spelling";
    return "style";
  }

  return beforeWords.length === afterWords.length ? "grammar" : "style";
}

function stripPunctuation(word: string): string {
  return word.replace(/[^\p{L}\p{N}]/gu, "");
}

/** A single-word change small enough to read as a typo fix rather than a
 *  rewording. Length proximity is a cheap stand-in for edit distance. */
function isNearMiss(a: string, b: string): boolean {
  const left = stripPunctuation(a).toLowerCase();
  const right = stripPunctuation(b).toLowerCase();
  if (Math.abs(left.length - right.length) > 2) return false;

  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  let shared = 0;
  for (let i = 0; i < shorter.length; i += 1) {
    if (longer.includes(shorter.charAt(i))) shared += 1;
  }
  return shared >= Math.ceil(shorter.length * 0.7);
}
