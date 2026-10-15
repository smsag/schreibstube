import { getAllTags, normalizePath, TFile, type Plugin } from "obsidian";
import type { Logger } from "../../services/logger";
import type { IndexKeeper } from "../../services/semantic/embedding-index";
import {
  buildRelatedFile,
  namesProject,
  nextRelatedRun,
  relatedFileAction,
  sameRelatedContent,
  serializeRelatedFile,
  MAX_RELATED_BYTES,
  RELATED_DEBOUNCE_MS,
  RELATED_FILE_NAME,
  RELATED_INTERVAL_MS,
  RELATED_RETRY_MS,
  type ExportNote,
  type ExportRow
} from "../../services/semantic/related-export";
import { pluginDir } from "./index-files";

/** What the index offers the export, or null while it cannot answer. */
export interface RelatedSnapshot {
  rows: readonly ExportRow[];
  model: string;
  floor: number;
  maxChars: number;
}

/** The engine, as the export sees it. */
export interface RelatedExportHost {
  /** The kind of device this is; only the desktop keeps the index. */
  device: IndexKeeper;
  /** Whether search by meaning is switched on, whatever else holds it. */
  switchedOn(): boolean;
  /** The index's rows, ready and not being built; null otherwise. */
  snapshot(): RelatedSnapshot | null;
  /** What a search can find changed. Returns the unsubscribe. */
  onContentChange(listener: () => void): () => void;
}

export interface RelatedExportTiming {
  debounceMs: number;
  intervalMs: number;
  retryMs: number;
  now(): number;
}

const TIMING: RelatedExportTiming = {
  debounceMs: RELATED_DEBOUNCE_MS,
  intervalMs: RELATED_INTERVAL_MS,
  retryMs: RELATED_RETRY_MS,
  now: () => Date.now()
};

/**
 * Writes the list Nimbus reads (contracts/RELATED.md): what the index finds
 * related to each project note, in `nimbus-related.json` beside the index.
 *
 * Only on the device that keeps the index, so two devices never write the
 * file at once; after the index changed or a project note did, once things
 * have been quiet for a while and at most every five minutes; and only when
 * what it says differs from what is on disk, so an unchanged vault is not a
 * sync event. The decisions are in `services/semantic/related-export.ts`.
 */
export class RelatedExportWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRunAt = Number.NEGATIVE_INFINITY;
  private running = false;
  private again = false;
  private disposed = false;
  /** The notes that named a project at the last run, so taking the key out
   *  of one is a change to the list too. */
  private projectNotes = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly plugin: Plugin,
    private readonly host: RelatedExportHost,
    private readonly logger: Pick<Logger, "debug" | "warn">,
    private readonly timing: RelatedExportTiming = TIMING
  ) {}

  /** The file's path in the vault. */
  path(): string {
    return normalizePath(`${pluginDir(this.plugin)}/${RELATED_FILE_NAME}`);
  }

  start(): void {
    // A phone never writes the file, nor deletes it: it is the desktop's.
    if (this.host.device !== "desktop") return;
    this.unsubscribe = this.host.onContentChange(() => this.schedule());
    this.plugin.registerEvent(
      this.plugin.app.metadataCache.on("changed", (file, _data, cache) => {
        if (this.projectNotes.has(file.path) || namesProject(cache.frontmatter)) this.schedule();
      })
    );
    this.plugin.app.workspace.onLayoutReady(() => this.settingsChanged());
  }

  /** Switched on: a run is owed. Switched off: the file goes. */
  settingsChanged(): void {
    if (this.disposed) return;
    const action = relatedFileAction({
      device: this.host.device,
      switchedOn: this.host.switchedOn()
    });
    if (action === "write") this.schedule();
    else if (action === "delete") {
      this.cancel();
      void this.remove();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Run once things are quiet, and not sooner than the interval allows. */
  private schedule(delayMs?: number): void {
    if (this.disposed || this.host.device !== "desktop") return;
    this.cancel();
    const now = this.timing.now();
    const at =
      delayMs === undefined
        ? nextRelatedRun(now, this.lastRunAt, this.timing.debounceMs, this.timing.intervalMs)
        : now + delayMs;
    this.timer = setTimeout(() => void this.run(), Math.max(0, at - now));
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private action(): "write" | "delete" | "none" {
    return relatedFileAction({ device: this.host.device, switchedOn: this.host.switchedOn() });
  }

  /** One run: build the list, and write it when it says something new. */
  async run(): Promise<void> {
    this.timer = null;
    if (this.disposed) return;
    if (this.running) {
      this.again = true;
      return;
    }
    const action = this.action();
    if (action === "delete") return this.remove();
    if (action !== "write") return;
    const snapshot = this.host.snapshot();
    if (!snapshot) {
      // Being built, or not read yet: the list waits for the index.
      this.schedule(this.timing.retryMs);
      return;
    }
    this.running = true;
    this.lastRunAt = this.timing.now();
    try {
      const file = await buildRelatedFile({
        ...snapshot,
        notes: this.collect(),
        now: this.timing.now(),
        load: (path) => this.load(path)
      });
      // Switched off or unloaded while it ran: nothing is written.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dispose() may set it while this one awaited
      if (this.disposed || this.action() !== "write") return;
      if (sameRelatedContent(await this.current(), file)) return;
      await this.write(serializeRelatedFile(file));
      this.logger.debug("related export: written", {
        projects: file.projects.length,
        related: file.projects.reduce((n, p) => n + p.related.length, 0)
      });
    } catch (e) {
      this.logger.warn("related export: the list for Nimbus could not be written", e);
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }

  /** Every Markdown note with what the metadata cache says about it. */
  private collect(): ExportNote[] {
    const app = this.plugin.app;
    const projects = new Set<string>();
    const notes = app.vault.getMarkdownFiles().map((file): ExportNote => {
      const cache = app.metadataCache.getFileCache(file);
      if (namesProject(cache?.frontmatter)) projects.add(file.path);
      return {
        path: file.path,
        mtime: file.stat.mtime,
        frontmatter: cache?.frontmatter,
        tags: cache
          ? (getAllTags(cache) ?? []).map((tag) => tag.replace(/^#/, "").toLowerCase())
          : null
      };
    });
    this.projectNotes = projects;
    return notes;
  }

  private async load(path: string): Promise<string | null> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? this.plugin.app.vault.cachedRead(file) : null;
  }

  /** The file as it is on disk; null when there is none or it is too large
   *  to be one a reader accepts, which differs from anything written. */
  private async current(): Promise<string | null> {
    const adapter = this.plugin.app.vault.adapter;
    const path = this.path();
    const stat = await adapter.stat(path);
    if (!stat || stat.size > MAX_RELATED_BYTES) return null;
    return adapter.read(path);
  }

  /** Written over itself, like the index's journal: a file moved in under a
   *  name iCloud is still syncing is kept as a numbered copy. A write cut
   *  short is a file the reader refuses and says so, until the next run. */
  private async write(text: string): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    const dir = pluginDir(this.plugin);
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.write(this.path(), text);
  }

  private async remove(): Promise<void> {
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (await adapter.exists(this.path())) await adapter.remove(this.path());
    } catch (e) {
      this.logger.warn("related export: the list for Nimbus could not be removed", e);
    }
  }
}
