/**
 * What the little mark on a note's icon means.
 *
 * The explorer shows sync state where the file is, rather than only in the
 * review panel, because the question "is this note still the source's" is asked
 * while looking at a list, not while reading the note. The badge is derived
 * from state the plugin already keeps: the frontmatter binding and the record
 * the poller writes. Nothing here fetches anything.
 *
 * Shape carries the meaning and colour only reinforces it, so the badge still
 * works for a reader who cannot tell the green from the amber.
 */
import type { SyncRecord } from "./sync-document";

export type SyncBadge =
  /** Not bound to a source: no badge at all. */
  | "none"
  /** Bound, and the last check found nothing new. */
  | "synced"
  /** The poll found changes that nobody has looked at yet. */
  | "pending"
  /** Bound but never checked, so the plugin has nothing to claim. */
  | "unchecked"
  /** Bound to something that cannot be fetched, or the last fetch failed. */
  | "error";

export interface SyncBadgeInput {
  /** Whether the note carries a source binding in its frontmatter. */
  bound: boolean;
  /** False when the binding is there but not a URL the plugin will fetch. */
  sourceValid: boolean;
  record?: SyncRecord;
}

export function syncBadgeFor({ bound, sourceValid, record }: SyncBadgeInput): SyncBadge {
  if (!bound) return "none";
  if (!sourceValid) return "error";
  if (!record || record.checkedAt === 0) return "unchecked";
  return (record.pendingChanges ?? 0) > 0 ? "pending" : "synced";
}

/** The glyph for a badge, from the bundled icon set. */
export function syncBadgeIcon(badge: SyncBadge): string {
  switch (badge) {
    case "synced":
      return "cloud-check";
    case "pending":
      return "cloud-download";
    case "unchecked":
      return "cloud";
    case "error":
      return "cloud-off";
    default:
      return "";
  }
}
