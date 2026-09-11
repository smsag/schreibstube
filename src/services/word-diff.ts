/**
 * Word-level diff between an original block and its rewrite.
 *
 * The model is never asked to emit a diff. It returns clean prose, and this
 * module derives the change set locally, which is what makes a card's before
 * and after trustworthy: the offsets come from the document, not the response.
 */

export type DiffOp = "equal" | "insert" | "delete";

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
  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return wholeReplacement(before, after);
  }

  return backtrack(a, b, lcsTable(a, b));
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
      after: pending.after,
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

function wholeReplacement(before: string, after: string): DiffSegment[] {
  const segments: DiffSegment[] = [];
  if (before.length > 0) segments.push({ op: "delete", text: before });
  if (after.length > 0) segments.push({ op: "insert", text: after });
  return segments;
}

/** Classic longest-common-subsequence length table over tokens. */
function lcsTable(a: string[], b: string[]): Uint32Array {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  return table;
}

function backtrack(a: string[], b: string[], table: Uint32Array): DiffSegment[] {
  const width = b.length + 1;
  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;

  const push = (op: DiffOp, text: string): void => {
    const last = segments[segments.length - 1];
    if (last && last.op === op) {
      last.text += text;
      return;
    }
    segments.push({ op, text });
  };

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push("delete", a[i]);
      i += 1;
    } else {
      push("insert", b[j]);
      j += 1;
    }
  }

  while (i < a.length) {
    push("delete", a[i]);
    i += 1;
  }
  while (j < b.length) {
    push("insert", b[j]);
    j += 1;
  }

  return segments;
}
