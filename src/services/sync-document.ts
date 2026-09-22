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

import { t } from "../i18n";
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
  /**
   * Hash of the source's body as the last check received it.
   *
   * The validator cannot answer this: once changes are waiting the next fetch
   * is unconditional, so every poll would report "changed" whether or not
   * anything at the other end had. This is what "the document changed" is
   * decided against, and what keeps `updatedAt` from following the polling
   * rather than the source.
   */
  remoteHash?: string;
  /**
   * Epoch milliseconds of the last check that found the source different.
   *
   * The moment the note's own `updatedAt` records, kept here as well so the
   * pane can order by it without reading and parsing every note's frontmatter,
   * and so it survives a note whose properties could not be written.
   */
  changedAt?: number;
  /**
   * The source this record was made against, as the note named it.
   *
   * What lets a record be recognised when the note is not where it was: a
   * note moved on another device arrives at a new path, and a record naming
   * the same source is the only thing that says the two belong together. It
   * also marks a record left over from a binding the note no longer has.
   */
  source?: string;
}

export interface SyncOutcomeInput {
  /** What the last check left behind, if anything. */
  record: SyncRecord | undefined;
  /** The note's body as it stands. */
  body: string;
  /** The source's body, or null when the fetch answered "unchanged". */
  remoteBody: string | null;
  /** The validator to keep for the next conditional request. */
  etag: string;
  checkedAt: number;
  /** How many changed regions the note still owes a person's attention. */
  pendingChanges: number;
  /** Whether the note now matches the source, which is what advances the
   *  baseline the divergence check is made against. */
  settled: boolean;
  /** The source the check was made against. Absent keeps what the record had. */
  source?: string;
}

/**
 * The record a successful check leaves behind.
 *
 * Written here rather than at each call site because there are two — a poll
 * over the vault and a check on the note in front of you — and when they
 * disagreed about what to record, half of what the plugin knows was written by
 * one of them and not the other.
 */
export function nextSyncRecord(input: SyncOutcomeInput): SyncRecord {
  const { record, body, remoteBody, etag, checkedAt, pendingChanges, settled } = input;
  const source = input.source ?? record?.source;
  const remoteHash = remoteBody === null ? record?.remoteHash : hashText(remoteBody);
  // One rule, asked once. Two spellings of it drifted apart the moment one of
  // them learned something the other did not.
  const remoteChanged = isRemoteChange(record, remoteBody);

  return {
    hash: settled ? hashText(body) : (record?.hash ?? hashText(body)),
    etag,
    checkedAt,
    pendingChanges,
    ...(remoteHash === undefined ? {} : { remoteHash }),
    ...(remoteChanged
      ? { changedAt: checkedAt }
      : record?.changedAt !== undefined
        ? { changedAt: record.changedAt }
        : {}),
    ...(source === undefined ? {} : { source })
  };
}

/**
 * Whether this outcome is one that changed the document.
 *
 * Three cases, and the middle one is the one that was wrong.
 *
 * **No record at all** — the source has never been fetched. That counts: the
 * document arriving is, from the note's point of view, its first version and
 * the moment worth recording.
 *
 * **A record from before this plugin kept a hash of the source.** It has no
 * baseline, and that is a fact about the bookkeeping rather than about the
 * document. Treating it as a change stamped every mirrored note in a vault the
 * first time it was checked after updating — a date they had not earned, a
 * place at the top of "Zuletzt" they had not earned, and a mark on the pane
 * saying something had come in when nothing had. The hash is adopted quietly
 * instead, and the next check has a baseline to compare against.
 *
 * **A record with a hash** — the only case where an answer can be given: the
 * document changed if its text is not the text last seen.
 */
export function isRemoteChange(record: SyncRecord | undefined, remoteBody: string | null): boolean {
  if (remoteBody === null) return false;
  if (record === undefined) return true;
  if (record.remoteHash === undefined) return false;

  return record.remoteHash !== hashText(remoteBody);
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
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: "", body: text };
  }

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() !== "---") continue;
    // A block that ends the note has no newline after it, and counting one
    // put every offset past the end of the text.
    const frontmatter = `${lines.slice(0, i + 1).join("\n")}${i + 1 < lines.length ? "\n" : ""}`;
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
  const noteText = normalizeNewlines(options.noteText);
  const { frontmatter, body } = splitNote(noteText);
  const offset = frontmatter.length;

  return diffHunks(body, options.remoteBody).map((hunk) =>
    createSuggestion(
      {
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
      },
      // A source that gained a block makes a card with nothing of its own to be
      // found by; this is what it is found by instead.
      noteText.slice(0, offset + hunk.from)
    )
  );
}

function noteFor(state: LocalState): string {
  const cards = t().proofread;

  switch (state) {
    case "diverged":
      return cards.cardDiverged;
    case "unsynced":
      return cards.cardFirstSync;
    default:
      return "";
  }
}
