/**
 * What the file pane's publication mark says about a note.
 *
 * The mark follows the flag, not the website: a note carries it the moment it
 * is marked for publication in a publishing account's folder, because the flag
 * is the decision and the pane is where decisions are looked over. Whether the
 * decision has been carried out is the mark's title, read from what the plugin
 * already keeps — the time a publish wrote into the note, and the time of the
 * account's last run. Nothing here asks the bridge.
 */
import type { PublishAccount, PublishRunRecord } from "../types";
import { isInsideFolder, readPublishFields, type PublishKeyMap } from "./publish-index";

export type PublishMark =
  /** Not marked for publication, or not in any publishing account's folder. */
  | { state: "none" }
  /** Put online by the account's latest run, which recorded it in the note. */
  | { state: "published"; account: string; url: string; at: string }
  /**
   * Marked, but no record says the latest run carried it: not published yet,
   * or taken down while unmarked and waiting for the next run.
   */
  | { state: "marked"; account: string; recorded: boolean; lastRun: string | null };

export interface PublishMarkInput {
  path: string;
  frontmatter: unknown;
  accounts: readonly PublishAccount[];
  keys: PublishKeyMap;
  lastRuns: Readonly<Record<string, PublishRunRecord>>;
}

export function publishMarkFor({
  path,
  frontmatter,
  accounts,
  keys,
  lastRuns
}: PublishMarkInput): PublishMark {
  const account = accountFor(path, accounts);
  if (!account) return { state: "none" };
  if (!readPublishFields(frontmatter, keys).published) return { state: "none" };

  const record = asRecord(frontmatter);
  const lastRun = lastRuns[account.id]?.at ?? null;
  const publishedAt = timestamp(record[keys.publishedAt]);

  // A run writes its time into every note it carried, after it has recorded
  // itself, so a note from the latest run is never older than the run. An older
  // time is from a run that came before a takedown: the note is not online now.
  const current =
    publishedAt !== null && (lastRun === null || publishedAt >= (Date.parse(lastRun) || 0));
  if (account.writeBack && current) {
    return {
      state: "published",
      account: account.name,
      url: typeof record[keys.publishedUrl] === "string" ? String(record[keys.publishedUrl]) : "",
      at: new Date(publishedAt).toISOString()
    };
  }

  return { state: "marked", account: account.name, recorded: account.writeBack, lastRun };
}

/**
 * The account whose folder holds the note, the deepest one when folders nest,
 * since that is the site the note was put in most deliberately.
 */
function accountFor(path: string, accounts: readonly PublishAccount[]): PublishAccount | null {
  let best: PublishAccount | null = null;
  let depth = -1;
  for (const account of accounts) {
    if (!isInsideFolder(path, account.folder)) continue;
    const folderDepth = account.folder.replace(/^\/+|\/+$/g, "").length;
    if (folderDepth > depth) {
      best = account;
      depth = folderDepth;
    }
  }
  return best;
}

/** Milliseconds from what YAML and Obsidian leave of a time, or null. */
function timestamp(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
