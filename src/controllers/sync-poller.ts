/**
 * Checking every bound note, rather than the one that is open.
 *
 * Split from the review controller because the two share nothing but the store:
 * a poll cannot show cards, since only the open note has a panel. What it does
 * instead is record how many changes are waiting, so opening that note later
 * surfaces them at once.
 */
import { TFile, type App } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { resolveApiKey } from "../services/secret";
import { fetchSource } from "../services/sync-fetcher";
import { resolveSourceUrl, SYNC_FRONTMATTER_KEY } from "../services/sync-source";
import { diffHunks } from "../services/line-diff";
import {
  hashText,
  normalizeNewlines,
  splitNote,
  stripRemoteFrontmatter,
  type SyncRecord
} from "../services/sync-document";
import type { PollSummary, SyncStore } from "./proofread-controller";

/** How many sources are fetched at once, so one tick is not a burst. */
const POLL_CONCURRENCY = 4;

export class SyncPoller {
  private polling = false;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly syncStore: SyncStore,
    private readonly refreshActive: () => Promise<void>,
    private readonly logger: Logger
  ) {}

  /**
   * Check the bound source and turn any difference into cards.
   *
   * `manual` separates a deliberate check from the automatic one on note open:
   * the automatic check respects the minimum interval and stays silent when the
   * note is not bound, while a manual one always runs and always reports.
   */
  /** The GitHub token, if one is configured. Absent is normal: public sources
   *  need none, and the fetcher only ever sends it to GitHub anyway. */
  private githubToken(): string | undefined {
    return githubToken(this.app, this.getSettings());
  }

  /**
   * Check every bound note in the vault.
   *
   * A poll cannot show cards, because only the open note has a panel. What it
   * does instead is record how many changes are waiting, so opening that note
   * later surfaces them immediately, and report a single summary rather than one
   * notice per note.
   *
   * Requests are limited and the per-note interval still applies, so a vault
   * full of bound notes does not turn one tick into a burst of traffic.
   */
  async pollAllSources(trigger: "schedule" | "manual"): Promise<PollSummary> {
    const settings = this.getSettings();
    const empty: PollSummary = { checked: 0, withChanges: 0, failed: 0, notes: [] };

    if (!settings.syncEnabled || this.polling) return empty;

    const bound = this.app.vault.getMarkdownFiles().filter((file) => {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const value = frontmatter?.[SYNC_FRONTMATTER_KEY];
      return typeof value === "string" && value.trim().length > 0;
    });

    if (bound.length === 0) return empty;

    this.polling = true;
    const summary: PollSummary = { checked: 0, withChanges: 0, failed: 0, notes: [] };
    const token = this.githubToken();
    const updates: Record<string, SyncRecord> = {};

    try {
      let next = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const index = next;
          if (index >= bound.length) return;
          next += 1;
          await this.pollOne(bound[index], token, summary, updates);
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(POLL_CONCURRENCY, bound.length) }, () => worker())
      );

      if (Object.keys(updates).length > 0) {
        await this.syncStore.setMany(updates);
      }
    } finally {
      this.polling = false;
    }

    this.logger.debug(
      `Poll (${trigger}): ${summary.checked} checked, ${summary.withChanges} changed, ${summary.failed} failed.`
    );

    // Refresh the open note so a poll that touched it is reflected at once.
    await this.refreshActive();
    return summary;
  }

  private async pollOne(
    file: TFile,
    token: string | undefined,
    summary: PollSummary,
    updates: Record<string, SyncRecord>
  ): Promise<void> {
    const settings = this.getSettings();
    const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.[SYNC_FRONTMATTER_KEY];
    const resolved = resolveSourceUrl(raw);
    if (!resolved.ok) {
      summary.failed += 1;
      return;
    }

    const record = this.syncStore.get(file.path);
    if (!this.isCheckDue(record, settings.syncMinIntervalMinutes)) return;

    const checkedAt = Date.now();
    const conditional = (record?.pendingChanges ?? 0) > 0 ? undefined : record?.etag;

    let outcome: Awaited<ReturnType<typeof fetchSource>>;
    try {
      outcome = await fetchSource({
        url: resolved.url,
        target: resolved.target,
        etag: conditional,
        token
      });
    } catch (err) {
      this.logger.warn(`Poll failed for ${file.path}:`, err);
      summary.failed += 1;
      return;
    }

    summary.checked += 1;

    // Read from the vault rather than an editor: this note is not open. The
    // baseline is needed on every path, because a record stored without one is
    // discarded as malformed the next time settings load.
    const body = splitNote(normalizeNewlines(await this.app.vault.cachedRead(file))).body;

    if (outcome.status === "missing" || outcome.status === "error") {
      summary.failed += 1;
      // The clock advances even on failure, so a dead binding is not retried
      // on every tick. The note itself is never touched.
      updates[file.path] = {
        hash: record?.hash ?? hashText(body),
        etag: record?.etag ?? "",
        checkedAt,
        pendingChanges: record?.pendingChanges ?? 0
      };
      return;
    }

    if (outcome.status === "unchanged") {
      updates[file.path] = {
        hash: record?.hash ?? hashText(body),
        etag: outcome.etag,
        checkedAt,
        pendingChanges: record?.pendingChanges ?? 0
      };
      return;
    }

    const remoteBody = stripRemoteFrontmatter(outcome.body);
    const changes = diffHunks(body, remoteBody).length;

    updates[file.path] = {
      hash: changes === 0 ? hashText(body) : (record?.hash ?? hashText(body)),
      etag: outcome.etag,
      checkedAt,
      pendingChanges: changes
    };

    if (changes > 0) {
      summary.withChanges += 1;
      summary.notes.push(file.path);
    }
  }

  private isCheckDue(record: SyncRecord | undefined, minIntervalMinutes: number): boolean {
    return isCheckDue(record, minIntervalMinutes);
  }
}

/**
 * Whether enough time has passed to check this note's source again.
 *
 * Zero means every open, which is the setting for a source that changes often.
 * A note with no record has never been checked, so it is always due.
 */
export function isCheckDue(record: SyncRecord | undefined, minIntervalMinutes: number): boolean {
  if (!record || minIntervalMinutes <= 0) return true;
  return Date.now() - record.checkedAt >= minIntervalMinutes * 60_000;
}

/** The GitHub token, when one is configured and still present. */
export function githubToken(app: App, settings: SchreibstubeSettings): string | undefined {
  if (!settings.githubSecretName) return undefined;
  const result = resolveApiKey(app.secretStorage, settings.githubSecretName);
  return result.ok ? result.apiKey : undefined;
}
