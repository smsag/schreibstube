/**
 * Turns a fetched remote document into review cards against the local note.
 *
 * Two rules make this safe. The note's own frontmatter is never part of the
 * diff, because it holds the binding that makes the note a mirror in the first
 * place, and the remote file's frontmatter is stripped for the same reason: an
 * incoming `---` block would otherwise overwrite the binding and orphan the
 * note on the very first sync.
 *
 * Divergence is detected with a hash of the body as of the last sync. If the
 * note still matches it, everything that differs from the source is genuinely
 * incoming. If it does not, the user edited a mirror, and the panel says so
 * rather than quietly presenting their own words back as a remote change.
 */

import { diffHunks } from "./line-diff";
import { createSuggestion, type Suggestion } from "./suggestion";

export interface SyncRecord {
  /** Hash of the note body as of the last successful sync. */
  hash: string;
  /** Validator from the last response, for conditional requests. */
  etag: string;
  /** Epoch milliseconds of the last check, changed or not. */
  checkedAt: number;
  /**
   * Changes the background poll saw and could not show, because the note was
   * not open. Non-zero means the next check must fetch the body unconditionally:
   * the poll already advanced the validator, so a conditional request would
   * answer "unchanged" and the update would be lost.
   */
  pendingChanges?: number;
}

export type LocalState =
  /** Never synced, so there is no baseline to judge divergence against. */
  | "unsynced"
  /** Unchanged since the last sync: differences are incoming. */
  | "clean"
  /** Edited locally since the last sync. */
  | "diverged";

export interface NoteParts {
  /** The note's own frontmatter block, including delimiters and trailing
   *  newline. Empty when the note has none. */
  frontmatter: string;
  body: string;
}

/** Split a note into its frontmatter block and everything after it. */
export function splitNote(text: string): NoteParts {
  if (!text.startsWith("---")) {
    return { frontmatter: "", body: text };
  }

  const lines = text.split("\n");
  if (lines[0].trim() !== "---") {
    return { frontmatter: "", body: text };
  }

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== "---") continue;
    const frontmatter = `${lines.slice(0, i + 1).join("\n")}\n`;
    return { frontmatter, body: text.slice(frontmatter.length) };
  }

  // An unterminated block is not frontmatter; treat the whole note as body.
  return { frontmatter: "", body: text };
}

/** Drop the remote file's own frontmatter, which must never reach the note. */
export function stripRemoteFrontmatter(text: string): string {
  return splitNote(normalizeNewlines(text)).body;
}

/** Compare the note body against its last-synced hash. */
export function localState(body: string, record: SyncRecord | undefined): LocalState {
  if (!record) return "unsynced";
  return hashText(body) === record.hash ? "clean" : "diverged";
}

/**
 * Non-cryptographic hash, used only to answer "did this text change since we
 * last looked". FNV-1a keeps it short, stable across sessions, and free of a
 * dependency.
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** CRLF in a fetched file would otherwise show up as a change on every line. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export interface SyncSuggestionOptions {
  /** Full note text, frontmatter included. */
  noteText: string;
  /** Remote body, already stripped of its own frontmatter. */
  remoteBody: string;
  /** Whether the note carries local edits, which changes how a card reads. */
  state: LocalState;
}

/**
 * Build one card per changed region.
 *
 * Offsets are shifted past the note's frontmatter, so accepting a card edits
 * the body and leaves the binding untouched.
 */
export function buildSyncSuggestions(options: SyncSuggestionOptions): Suggestion[] {
  const { frontmatter, body } = splitNote(normalizeNewlines(options.noteText));
  const offset = frontmatter.length;

  return diffHunks(body, options.remoteBody).map((hunk, index) =>
    createSuggestion(`remote-${index}`, {
      kind: hunk.before.length === 0 ? "insert" : hunk.after.length === 0 ? "delete" : "replace",
      source: "remote",
      category: "update",
      severity: "suggestion",
      from: offset + hunk.from,
      to: offset + hunk.to,
      original: hunk.before,
      replacement: hunk.after,
      note: noteFor(options.state),
      // A mirror with local edits presents them back as changes to undo, which
      // the user has to see coming rather than discover after accepting.
      needsReview: options.state === "diverged"
    })
  );
}

function noteFor(state: LocalState): string {
  switch (state) {
    case "diverged":
      return "Lokale Änderung — Übernehmen stellt den Stand der Quelle wieder her.";
    case "unsynced":
      return "Erster Abgleich mit der Quelle.";
    default:
      return "";
  }
}
