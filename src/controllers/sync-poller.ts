/**
 * Checking every bound note, rather than the one that is open.
 *
 * Split from the review controller because the two share nothing but the store:
 * a poll cannot show cards, since only the open note has a panel. What it does
 * instead is record how many changes are waiting, so opening that note later
 * surfaces them at once.
 */
import { MarkdownView, TFile, type App } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { resolveApiKey } from "../services/secret";
import { fetchSource } from "../services/sync-fetcher";
import {
  frontmatterLine,
  hasSourceBinding,
  resolveSourceUrl,
  sourceUrlFromNote,
  SYNC_FRONTMATTER_KEY
} from "../services/sync-source";
import { parseSyncEvery, planSourceCheck, SYNC_EVERY_KEY } from "../services/sync-interval";
import { diffHunks } from "../services/line-diff";
import {
  planFrontmatterEdit,
  planSyncFrontmatter,
  SYNC_TITLE_KEY,
  SYNC_UPDATED_KEY
} from "../services/sync-frontmatter";
import {
  isRemoteChange,
  nextSyncRecord,
  normalizeNewlines,
  splitNote,
  stripRemoteFrontmatter,
  type SyncRecord
} from "../services/sync-document";
import {
  findMovedRecord,
  reconcileSyncState,
  recordForSource,
  type NoteBinding
} from "../services/sync-reconcile";
import type { SyncStore } from "./proofread-controller";
import type { PollSummary } from "../services/sync-summary";

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
    await this.reconcile();
    return this.check(this.boundNotes(), trigger, false);
  }

  /**
   * Drop the records the notes no longer vouch for.
   *
   * A note unbound, or bound elsewhere, on another device arrives here as a
   * note whose frontmatter says so, and nothing else: no unbind ran on this
   * device to clear the record. `paths` narrows it to the notes that just
   * changed; without it every record is judged, which is what a poll does
   * before it starts.
   */
  async reconcile(paths?: readonly string[]): Promise<void> {
    await this.syncStore.update((state) =>
      reconcileSyncState({
        state,
        bindingOf: (path) => this.bindingOf(path),
        ...(paths === undefined ? {} : { paths }),
        now: Date.now()
      })
    );
  }

  /**
   * The record this note left at the path it was moved from, taken over.
   *
   * Public because the review panel checks the open note by itself, and a note
   * that moved is the same note whichever of the two checks it first.
   */
  async adoptMovedRecord(file: TFile, source: string): Promise<SyncRecord | undefined> {
    let body: string;
    try {
      body = splitNote(normalizeNewlines(await this.app.vault.cachedRead(file))).body;
    } catch {
      return undefined;
    }

    const oldPath = findMovedRecord({
      state: this.syncStore.all(),
      source,
      body,
      exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null
    });
    if (oldPath === null) return undefined;

    let adopted: SyncRecord | undefined;
    await this.syncStore.update((state) => {
      const { [oldPath]: record, ...rest } = state;
      if (record === undefined || state[file.path] !== undefined) return null;
      adopted = record;
      return { ...rest, [file.path]: record };
    });

    if (adopted !== undefined) {
      this.logger.debug(`${file.path}: took over the sync record left at ${oldPath}.`);
    }
    return adopted;
  }

  /** What the note at a path says about its source, from the metadata cache. */
  private bindingOf(path: string): NoteBinding {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return { kind: "missing" };

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return { kind: "unknown" };

    const raw: unknown = cache.frontmatter?.[SYNC_FRONTMATTER_KEY];
    if (typeof raw !== "string" || raw.trim().length === 0) return { kind: "unbound" };

    const resolved = resolveSourceUrl(raw);
    return { kind: "bound", source: resolved.ok ? resolved.url : raw.trim() };
  }

  /**
   * Check the notes bound to a source inside one folder.
   *
   * The explorer offers this on a folder, so a person can refresh one project
   * without waiting for a poll across a vault of a thousand notes.
   */
  async pollFolder(folderPath: string): Promise<PollSummary> {
    const prefix = folderPath === "/" ? "" : `${folderPath}/`;
    return this.check(
      this.boundNotes().filter((file) => file.path.startsWith(prefix)),
      "manual",
      true
    );
  }

  /**
   * Check one note, open or not.
   *
   * This is the entry point the explorer's context menu uses, and the reason it
   * exists: everything else here either walks the whole vault or works on the
   * note that happens to be open. `force` skips the minimum interval, because
   * someone who asked for a check means now rather than in ten minutes.
   */
  async checkFile(file: TFile, force = true): Promise<PollSummary> {
    return this.check([file], "manual", force);
  }

  /** Every Markdown note that names a source in its frontmatter. */
  private boundNotes(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => hasSourceBinding(this.app.metadataCache.getFileCache(file)?.frontmatter));
  }

  /** The shared machinery: a bounded pool, one save, one summary. */
  private async check(
    files: TFile[],
    trigger: "schedule" | "manual",
    force: boolean
  ): Promise<PollSummary> {
    const settings = this.getSettings();
    const empty: PollSummary = { checked: 0, withChanges: 0, failed: 0, notes: [] };

    // Said out loud rather than returned as an empty result: a note that is
    // bound to a source and a plugin that is not checking anything look the
    // same from the summary, and only one of them is the person's mistake.
    if (!settings.syncEnabled) return { ...empty, skipped: "disabled" };
    if (this.polling) return { ...empty, skipped: "busy" };
    if (files.length === 0) return empty;

    this.polling = true;
    const summary: PollSummary = { checked: 0, withChanges: 0, failed: 0, notes: [] };
    const updates: Record<string, SyncRecord> = {};

    try {
      // Inside the guard, not before it: anything that throws between setting
      // the flag and clearing it leaves every later check answering "busy".
      const token = this.githubToken();
      let next = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const file = files[next];
          if (file === undefined) return;
          next += 1;
          await this.pollOne(file, token, summary, updates, force);
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(POLL_CONCURRENCY, files.length) }, () => worker())
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
    updates: Record<string, SyncRecord>,
    force = false
  ): Promise<void> {
    const settings = this.getSettings();
    const raw = await this.readBinding(file);
    const resolved = resolveSourceUrl(raw);
    if (!resolved.ok) {
      this.fail(file, resolved.reason, summary);
      return;
    }

    const record =
      recordForSource(this.syncStore.get(file.path), resolved.url) ??
      (await this.adoptMovedRecord(file, resolved.url));
    // What the note itself asks for comes first: a poll across the vault is one
    // schedule for every source, and only the note knows how often its own is
    // worth asking about.
    const own = await this.readInterval(file);
    if (own !== null && !own.ok) {
      this.fail(file, own.reason, summary);
      return;
    }

    const plan = planSourceCheck({
      record,
      schedule: own === null ? null : own.schedule,
      minIntervalMinutes: settings.syncMinIntervalMinutes,
      now: new Date()
    });
    if (!force && !plan.due) return;

    const checkedAt = Date.now();

    let outcome: Awaited<ReturnType<typeof fetchSource>>;
    let body: string;
    try {
      outcome = await fetchSource({
        url: resolved.url,
        target: resolved.target,
        etag: plan.etag,
        token
      });
      // Read from the vault rather than an editor: this note is not open. The
      // baseline is needed on every path, because a record stored without one
      // is discarded as malformed the next time settings load. Inside the
      // guard, because a note a sync client took away between the listing and
      // this read used to reject the whole poll, and every other note's result
      // with it.
      body = splitNote(normalizeNewlines(await this.app.vault.cachedRead(file))).body;
    } catch (err) {
      this.fail(file, err instanceof Error ? err.message : String(err), summary);
      return;
    }

    summary.checked += 1;

    if (outcome.status === "missing" || outcome.status === "error") {
      this.fail(file, outcome.message, summary);
      // The clock advances even on failure, so a dead binding is not retried
      // on every tick. The note itself is never touched.
      updates[file.path] = nextSyncRecord({
        record,
        body,
        remoteBody: null,
        etag: record?.etag ?? "",
        checkedAt,
        pendingChanges: record?.pendingChanges ?? 0,
        source: resolved.url,
        settled: false
      });
      return;
    }

    if (outcome.status === "unchanged") {
      updates[file.path] = nextSyncRecord({
        record,
        body,
        remoteBody: null,
        etag: outcome.etag,
        checkedAt,
        pendingChanges: record?.pendingChanges ?? 0,
        source: resolved.url,
        settled: false
      });
      // Nothing came back to read a title out of, but the note's own body may
      // still hold one, and a note without a title has never had it written.
      await this.writeFrontmatter(file, null, body, false);
      return;
    }

    const remoteBody = stripRemoteFrontmatter(outcome.body);
    const changes = diffHunks(body, remoteBody).length;
    const remoteChanged = isRemoteChange(record, remoteBody);

    updates[file.path] = nextSyncRecord({
      record,
      body,
      remoteBody,
      etag: outcome.etag,
      checkedAt,
      pendingChanges: changes,
      source: resolved.url,
      settled: changes === 0
    });

    await this.writeFrontmatter(file, remoteBody, body, remoteChanged);

    if (changes > 0) {
      summary.withChanges += 1;
      summary.notes.push(file.path);
    }
  }

  /**
   * Count a failure, and say what it was.
   *
   * A poll has no panel to put a message on, and for a long time it put it
   * nowhere: a source that answered 404 to every check was counted and not
   * named, so a token that could not see its repository looked, from the
   * notice, exactly like a note that was fine. The reason goes to the console
   * for every note and into the summary for the first, which is what the
   * notice for a single note shows.
   */
  private fail(file: TFile, reason: string, summary: PollSummary): void {
    summary.failed += 1;
    summary.reason ??= reason;
    this.logger.warn(`${file.path}: ${reason}`);
  }

  /**
   * How often this note asks to be checked, or null when it does not say.
   *
   * Read the way the binding beside it is read, cache first and the note's own
   * frontmatter when the cache has nothing to say, so a note bound and given an
   * interval in the same breath is not checked on the wrong one.
   */
  private async readInterval(file: TFile): Promise<ReturnType<typeof parseSyncEvery>> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter?.[SYNC_EVERY_KEY];
    if (cached !== undefined && cached !== null) return parseSyncEvery(cached);

    try {
      return parseSyncEvery(frontmatterLine(await this.app.vault.read(file), SYNC_EVERY_KEY));
    } catch (err) {
      this.logger.warn(`Could not read ${file.path} for its check interval:`, err);
      return null;
    }
  }

  /**
   * The source this note names.
   *
   * The metadata cache first, and the note itself when the cache has nothing:
   * a check made in the same breath as the binding — which is what happens
   * when somebody has just typed a URL in — would otherwise be told the note
   * names no source and report an error for a note that had just been bound.
   */
  private async readBinding(file: TFile): Promise<unknown> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter?.[SYNC_FRONTMATTER_KEY];
    if (typeof cached === "string" && cached.trim().length > 0) return cached;

    try {
      return sourceUrlFromNote(await this.app.vault.read(file));
    } catch (err) {
      this.logger.warn(`Could not read ${file.path} for its binding:`, err);
      return cached;
    }
  }

  /**
   * Keep the note's own `title` and `updatedAt` current.
   *
   * Public because the review panel fetches a source itself, for the note in
   * front of you, and a note's properties should not depend on which of the two
   * ways it was checked.
   */
  async writeNoteProperties(
    file: TFile,
    remoteBody: string | null,
    noteBody: string,
    remoteChanged: boolean
  ): Promise<void> {
    return this.writeFrontmatter(file, remoteBody, noteBody, remoteChanged);
  }

  private async writeFrontmatter(
    file: TFile,
    remoteBody: string | null,
    noteBody: string,
    remoteChanged: boolean
  ): Promise<void> {
    const plan = planSyncFrontmatter({
      frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter,
      remoteBody,
      noteBody,
      remoteChanged,
      now: new Date()
    });

    if (plan.title === undefined && plan.updatedAt === undefined) return;

    // An open note is written through its editor. Written to disk instead, the
    // editor is merged with the file afterwards, and Obsidian's merge silently
    // drops an edit it cannot place — a document just accepted from the source
    // among them.
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file?.path !== file.path) continue;

      const planned = planFrontmatterEdit(view.editor.getValue(), plan);
      // Nothing to write is not a reason to write it somewhere else: the
      // editor holds a title the person typed and the cache has not caught up
      // with, and the writer below would put the source's title over it.
      if (planned.kind === "nothing") return;
      if (planned.kind === "unwritable") break;

      const { edit } = planned;
      view.editor.transaction({
        changes: [
          {
            from: view.editor.offsetToPos(edit.from),
            to: view.editor.offsetToPos(edit.to),
            text: edit.text
          }
        ]
      });
      return;
    }

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (plan.title !== undefined) frontmatter[SYNC_TITLE_KEY] = plan.title;
        if (plan.updatedAt !== undefined) frontmatter[SYNC_UPDATED_KEY] = plan.updatedAt;
      });
    } catch (err) {
      // A note whose properties could not be written is still a note that was
      // checked; the check is not failed over its bookkeeping.
      this.logger.warn(`Could not write properties for ${file.path}:`, err);
    }
  }
}

/** The GitHub token, when one is configured and still present. */
export function githubToken(app: App, settings: SchreibstubeSettings): string | undefined {
  if (!settings.githubSecretName) return undefined;
  const result = resolveApiKey(app.secretStorage, settings.githubSecretName);
  return result.ok ? result.apiKey : undefined;
}
