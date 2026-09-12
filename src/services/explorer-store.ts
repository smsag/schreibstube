/**
 * Where the explorer's icons and pins live, and how two devices share them.
 *
 * The state sits in its own file next to the plugin's `data.json` rather than
 * inside it, for one reason: `data.json` is written by overwriting the whole
 * settings object, so a device holding a stale copy in memory would clobber
 * everything another device wrote, including mailbox and publishing state. A
 * separate file limits the blast radius of a bad merge to icons, and lets every
 * write take the cheap read-modify-merge path below.
 *
 * Three habits make the file survive iCloud, Obsidian Sync and Git:
 *
 * - **Read before write.** Every flush re-reads the file and merges per entry,
 *   so a change made elsewhere between two writes is not overwritten.
 * - **Poll for foreign writes.** A sync client drops a new file in without
 *   telling anyone; `refreshFromDisk` notices by modification time.
 * - **Debounce.** Pinning three notes in a row is one write, not three, which
 *   is what keeps a sync client from seeing a conflict at all.
 */
import type { Logger } from "./logger";
import {
  emptyExplorerData,
  mergeExplorerData,
  parseExplorerData,
  pruneExplorerData,
  serializeExplorerData,
  type ExplorerData
} from "./explorer-state";

/** The file, as the store needs it. Implemented over Obsidian's vault adapter;
 *  a test hands in a map in memory. */
export interface ExplorerFileStore {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  /** Modification time in epoch ms, or null when the file is not there. */
  mtime(): Promise<number | null>;
}

export interface ExplorerStoreOptions {
  file: ExplorerFileStore;
  logger: Logger;
  now?: () => number;
  /** How long a burst of changes is collected before it reaches disk. */
  writeDelayMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const DEFAULT_WRITE_DELAY_MS = 400;

export class ExplorerStore {
  private current: ExplorerData = emptyExplorerData();
  private lastWritten = "";
  private lastMtime: number | null = null;
  private dirty = false;
  private timer: unknown = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  private readonly file: ExplorerFileStore;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly writeDelayMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(options: ExplorerStoreOptions) {
    this.file = options.file;
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
    this.writeDelayMs = options.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS;
    this.setTimer = options.setTimer ?? ((callback, ms) => window.setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => window.clearTimeout(handle as number));
  }

  /** The state as it stands. Treated as immutable by everything that reads it. */
  data(): ExplorerData {
    return this.current;
  }

  /** Called whenever the state changed, whoever changed it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    const disk = await this.readDisk();
    this.current = pruneExplorerData(disk.data, this.now());
    this.lastWritten = disk.text;
    this.lastMtime = disk.mtime;
  }

  /** Merge the file into memory, then drop what has expired.
   *
   *  Pruning after the merge rather than only at load is what makes the grace
   *  period mean anything: the merge starts from the file, so an entry pruned
   *  from memory at load comes straight back from disk on the next flush and
   *  the file only ever grows. */
  private reconcile(disk: ExplorerData): ExplorerData {
    return pruneExplorerData(mergeExplorerData(this.current, disk), this.now());
  }

  /**
   * Change the state and schedule a write.
   *
   * The change is applied to memory immediately, because the view redraws from
   * memory and a person tapping "pin" should not wait for a disk write to see
   * it happen.
   */
  mutate(change: (data: ExplorerData, now: number) => ExplorerData): void {
    const next = change(this.current, this.now());
    if (next === this.current) return;

    this.current = next;
    this.dirty = true;
    this.emit();
    this.scheduleFlush();
  }

  /** Write pending changes now, merging in whatever the file holds. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (!this.dirty) return;

    await this.serialize(async () => {
      if (!this.dirty) return;
      this.dirty = false;

      const disk = await this.readDisk();
      const merged = this.adopt(this.reconcile(disk.data));
      const text = serializeExplorerData(merged);

      if (text === disk.text) {
        this.lastWritten = text;
        this.lastMtime = disk.mtime;
        return;
      }

      try {
        await this.file.write(text);
        this.lastWritten = text;
        this.lastMtime = await this.file.mtime();
      } catch (error) {
        // Left dirty on purpose: the next change, or the next flush, retries.
        this.dirty = true;
        this.logger.warn("Could not write the explorer state file.", error);
      }
    });
  }

  /**
   * Pick up a write made somewhere else.
   *
   * The modification-time check is what makes this cheap enough to run on a
   * timer while the pane is open. A vault synced by iCloud gets the other
   * device's icons without anyone reopening the vault.
   */
  async refreshFromDisk(): Promise<boolean> {
    let changed = false;

    await this.serialize(async () => {
      const mtime = await this.safely(() => this.file.mtime(), null);
      if (mtime !== null && mtime === this.lastMtime) return;

      const disk = await this.readDisk();
      if (disk.text === this.lastWritten) {
        this.lastMtime = disk.mtime;
        return;
      }

      const before = this.current;
      this.adopt(this.reconcile(disk.data));
      this.lastWritten = disk.text;
      this.lastMtime = disk.mtime;

      if (this.current !== before) {
        changed = true;
        this.emit();
      }

      // Our own unwritten changes still have to reach the file.
      if (this.dirty) this.scheduleFlush();
    });

    return changed;
  }

  dispose(): void {
    this.cancelTimer();
    this.listeners.clear();
  }

  /** Adopt a merge result, keeping the object identity stable when nothing in
   *  it actually differs, so listeners are not woken for a no-op. */
  private adopt(next: ExplorerData): ExplorerData {
    if (serializeExplorerData(next) === serializeExplorerData(this.current)) return this.current;
    this.current = next;
    return this.current;
  }

  private async readDisk(): Promise<{ data: ExplorerData; text: string; mtime: number | null }> {
    const text = await this.safely(() => this.file.read(), null);
    const mtime = await this.safely(() => this.file.mtime(), null);

    if (text === null) return { data: emptyExplorerData(), text: "", mtime };

    try {
      return { data: parseExplorerData(JSON.parse(text)), text, mtime };
    } catch (error) {
      // A half-written file from a sync client, or someone's failed edit. Our
      // copy is the better one; the next flush replaces the broken file.
      this.logger.warn(
        "The explorer state file is not valid JSON; keeping the in-memory state.",
        error
      );
      return { data: emptyExplorerData(), text, mtime };
    }
  }

  private async safely<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.debug("Explorer state file is unavailable.", error);
      return fallback;
    }
  }

  private scheduleFlush(): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, this.writeDelayMs);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  /** One disk operation at a time, so a poll and a write cannot interleave and
   *  write back a half-merged state. */
  private serialize(operation: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(operation, operation);
    return this.queue;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
