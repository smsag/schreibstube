/**
 * Keeping the sync records in step with what the notes say.
 *
 * The binding lives in the note, and the note travels to every device with the
 * vault. The record beside it does not: it is written by whichever device ran
 * the check, and a device only ever updated it for things it did itself. Two
 * cases then left a device holding a record that no longer described anything.
 *
 * **A note unbound somewhere else.** The binding disappeared from the note, the
 * record stayed, and binding the note again later compared the new source
 * against a baseline from the old one — a note nobody had touched reported as
 * edited locally.
 *
 * **A note moved somewhere else.** A sync client is free to deliver a rename as
 * a delete and a create, and a device that was closed at the time sees neither:
 * the note is simply at a new path. The record stayed at the old one, and the
 * next check at the new path was a first sync, with a date the document had not
 * earned.
 *
 * Both are answered from the notes, because the notes are the part every device
 * agrees on. A record whose note says it is not bound, or bound to a different
 * source, is dropped. A record whose note is gone is kept for a while, and a
 * bound note with no record takes it over when it names the same source and
 * still holds the text the record was made against.
 */
import { hashText, type SyncRecord } from "./sync-document";

/** How long a record outlives its note, in case the note turns up elsewhere.
 *  The same thirty days the pane gives an icon whose file disappeared. */
export const ORPHAN_RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type NoteBinding =
  /** The note names this source. */
  | { kind: "bound"; source: string }
  /** The note exists and names no source. */
  | { kind: "unbound" }
  /** No note at this path. */
  | { kind: "missing" }
  /** The note exists but has not been indexed, so nothing can be said. */
  | { kind: "unknown" };

export interface ReconcileInput {
  state: Record<string, SyncRecord>;
  /** What the note at a path says. */
  bindingOf: (path: string) => NoteBinding;
  /** Only these records are judged; the rest are left as they are. Absent
   *  judges every record. */
  paths?: readonly string[];
  now: number;
}

/** The records as they should be, or null when nothing needs to change. */
export function reconcileSyncState(input: ReconcileInput): Record<string, SyncRecord> | null {
  const scope = input.paths === undefined ? null : new Set(input.paths);
  const next: Record<string, SyncRecord> = {};
  let changed = false;

  for (const [path, record] of Object.entries(input.state)) {
    if (scope === null || scope.has(path)) {
      if (isStale(record, input.bindingOf(path), input.now)) {
        changed = true;
        continue;
      }
    }
    next[path] = record;
  }

  return changed ? next : null;
}

function isStale(record: SyncRecord, binding: NoteBinding, now: number): boolean {
  switch (binding.kind) {
    case "unbound":
      return true;
    case "bound":
      return !belongsToSource(record, binding.source);
    case "missing":
      return now - record.checkedAt > ORPHAN_RECORD_TTL_MS;
    default:
      return false;
  }
}

/**
 * Whether a record describes this source.
 *
 * A record from before records named their source is given the benefit of the
 * doubt: it has always been read as this note's, and nothing it holds says
 * otherwise.
 */
export function belongsToSource(record: SyncRecord, source: string): boolean {
  return record.source === undefined || record.source === source;
}

/** The record a check should work from: none, when the one there was made
 *  against a different source. */
export function recordForSource(
  record: SyncRecord | undefined,
  source: string
): SyncRecord | undefined {
  return record !== undefined && belongsToSource(record, source) ? record : undefined;
}

export interface MovedRecordInput {
  state: Record<string, SyncRecord>;
  /** The source the note without a record names. */
  source: string;
  /** The note's body, frontmatter removed. */
  body: string;
  /** Whether a note still exists at a path. */
  exists: (path: string) => boolean;
}

/**
 * The path of the record a note left behind when it moved, or null.
 *
 * Three things have to agree: the note that was there is gone, the record names
 * the same source, and the note holds exactly the text the record's baseline
 * was taken from — a move does not change a note, and a note re-created from
 * scratch is not the one that moved. Anything less, or more than one record
 * that fits, and the note starts afresh rather than inheriting a guess.
 */
export function findMovedRecord(input: MovedRecordInput): string | null {
  const hash = hashText(input.body);
  const matches = Object.entries(input.state).filter(
    ([path, record]) =>
      record.source === input.source && record.hash === hash && !input.exists(path)
  );

  return matches.length === 1 ? (matches[0]?.[0] ?? null) : null;
}
