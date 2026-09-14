/**
 * Line-level diff, the change unit for a document coming in from a remote
 * source.
 *
 * A proof-read rewrite is edited word by word, but a document update is read
 * hunk by hunk: a changed paragraph, an added section, a deleted line. Hunks
 * are contiguous runs of changed lines, so one card covers one coherent edit
 * rather than scattering a rewritten paragraph across a dozen word changes.
 */

import { diffSequences } from "./lcs";

/** One contiguous change, in offsets relative to the local text. */
export interface Hunk {
  from: number;
  to: number;
  /** Lines currently at `[from, to)`. Empty for a pure insertion. */
  before: string;
  /** Lines proposed in their place. Empty for a pure deletion. */
  after: string;
}

/** Documents are compared whole, so the ceiling is higher than the word diff's.
 *  Past it, the update becomes a single all-or-nothing card. */
const MAX_LINES = 4000;

/** Split into lines that keep their terminator, so joining reconstructs the
 *  text exactly and every offset stays meaningful. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Contiguous changed regions between `before` and `after`. */
export function diffHunks(before: string, after: string): Hunk[] {
  const runs = diffSequences(splitLines(before), splitLines(after), MAX_LINES);
  const hunks: Hunk[] = [];

  let cursor = 0;
  let pending: { from: number; before: string; after: string } | null = null;

  const flush = (): void => {
    if (!pending) return;
    if (pending.before !== pending.after) {
      hunks.push({
        from: pending.from,
        to: pending.from + pending.before.length,
        before: pending.before,
        after: pending.after
      });
    }
    pending = null;
  };

  for (const run of runs) {
    const text = run.items.join("");

    if (run.op === "equal") {
      flush();
      cursor += text.length;
      continue;
    }

    pending ??= { from: cursor, before: "", after: "" };

    if (run.op === "delete") {
      pending.before += text;
      cursor += text.length;
    } else {
      pending.after += text;
    }
  }

  flush();
  return hunks;
}

/** Apply hunks to `before`, reproducing the text they were derived from. Used
 *  by tests and by any caller that wants the fully updated document. */
export function applyHunks(before: string, hunks: Hunk[]): string {
  let result = before;
  for (const hunk of [...hunks].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, hunk.from) + hunk.after + result.slice(hunk.to);
  }
  return result;
}
