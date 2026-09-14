/**
 * What a check across several notes amounts to, and how to say it.
 *
 * Three places used to word the same summary by hand — the vault-wide
 * command, the folder menu and the note menu — and they had already drifted:
 * one said "no bound notes" for a folder with a failed note in it, only one
 * knew how to name the failure. One decision, one wording, tested.
 */
import { t } from "../i18n";

export interface PollSummary {
  checked: number;
  withChanges: number;
  failed: number;
  /** Paths of notes with changes waiting, for the summary notice. */
  notes: string[];
  /**
   * Why nothing was checked, when that was not the notes' doing.
   *
   * Without this a poll that never ran is indistinguishable from a note that
   * names no source, and the notice blames the note for a switch being off.
   */
  skipped?: "disabled" | "busy";
  /** Why the first failed note failed, for a notice that names one note. */
  reason?: string;
}

export type SummaryScope =
  | { scope: "vault" }
  | { scope: "folder" }
  /** One note, named, so the notice can say it is up to date. */
  | { scope: "note"; name: string };

/** The sentence the notice shows for a summary. */
export function describePollSummary(summary: PollSummary, where: SummaryScope): string {
  const words = t().sync;

  // Why nothing happened comes first: a switch being off is not something the
  // notes can be blamed for, and it is the only answer that says what to do.
  if (summary.skipped === "disabled") return words.disabled;
  if (summary.skipped === "busy") return words.busy;

  if (where.scope === "note") {
    if (summary.failed > 0) {
      return summary.reason === undefined
        ? t().explorer.badge.error
        : t().explorer.bind.failed(summary.reason);
    }
    if (summary.withChanges > 0) return words.withUpdates(summary.withChanges);
    if (summary.checked === 0) return words.notBound;
    return t().explorer.bind.checked(where.name);
  }

  if (summary.checked === 0 && summary.failed === 0) {
    return where.scope === "folder" ? t().explorer.bind.folderEmpty : words.noneChecked;
  }
  return words.checked(summary.checked, summary.withChanges, summary.failed);
}
