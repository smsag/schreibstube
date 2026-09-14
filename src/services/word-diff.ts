/**
 * Word-level diff between an original block and its rewrite.
 *
 * The model is never asked to emit a diff. It returns clean prose, and this
 * module derives the change set locally, which is what makes a card's before
 * and after trustworthy: the offsets come from the document, not the response.
 */

import { diffSequences, type DiffOp } from "./lcs";

export type { DiffOp };

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

/** One contiguous change, in offsets relative to the original string. */
export interface Edit {
  from: number;
  to: number;
  /** Text currently at `[from, to)`. */
  before: string;
  /** Text proposed in its place. Empty for a pure deletion. */
  after: string;
}

/** Above this token count the quadratic table is not worth building, and a
 *  rewrite that large is a whole-block decision anyway. */
const MAX_TOKENS = 600;

/** Split into words and whitespace runs, keeping both so offsets reconstruct. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/gu) ?? [];
}

/** Word-level diff of `before` against `after`. */
export function diffWords(before: string, after: string): DiffSegment[] {
  return diffSequences(tokenize(before), tokenize(after), MAX_TOKENS).map((run) => ({
    op: run.op,
    text: run.items.join("")
  }));
}

/** Contiguous edits derived from the diff, dropping whitespace-only churn. */
export function diffToEdits(before: string, after: string): Edit[] {
  const segments = diffWords(before, after);
  const edits: Edit[] = [];

  let cursor = 0;
  let pending: { from: number; before: string; after: string } | null = null;

  const flush = (): void => {
    if (!pending) return;
    const edit: Edit = {
      from: pending.from,
      to: pending.from + pending.before.length,
      before: pending.before,
      after: pending.after
    };
    if (isMeaningful(edit)) {
      edits.push(edit);
    }
    pending = null;
  };

  for (const segment of segments) {
    if (segment.op === "equal") {
      flush();
      cursor += segment.text.length;
      continue;
    }

    pending ??= { from: cursor, before: "", after: "" };

    if (segment.op === "delete") {
      pending.before += segment.text;
      cursor += segment.text.length;
    } else {
      pending.after += segment.text;
    }
  }

  flush();
  return edits;
}

/** A change that only moves whitespace around is noise in a review queue. */
function isMeaningful(edit: Edit): boolean {
  // Comparing trimmed text keeps pure insertions and deletions (one side is
  // empty once trimmed, the other is not) while dropping whitespace-only churn
  // (both sides trim to the same thing).
  return edit.before.trim() !== edit.after.trim();
}
