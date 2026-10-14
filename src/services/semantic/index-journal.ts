// The vault index's journal (Pythia ADR-222, closes Pythia D-35).
//
// The index was one serialized array, so every write rewrote all of it — about
// 19 MB at the 5 000-note cap — whether one note had changed or a thousand. That
// is why crash-safe flushing had to be rate-limited (Pythia ADR-182), why a phone typing
// next to a loaded model reloaded (Pythia ADR-220), and why each edit was a 19 MB sync
// event on every device.
//
// Rewritten whole rather than appended: `appendBinary` needs Obsidian 1.12.3, the
// manifest promises 1.4.0, and a file this small costs nothing to rewrite.
//
// The shared journal is written by the device that keeps the index, the
// phone's by the phone. The copies iCloud kept of a journal that was
// replaced rather than written over (`conflict-copies.ts`) are read with it and
// merged, oldest write first, so no edit they hold is lost; the writer removes
// them once its own next write carries those edits.

import type { IndexStore } from "./index-store";
import { createLogger, type Logger } from "../logger";
import {
  deserializeIndex,
  readWrittenAt,
  serializeIndex,
  type IndexedConversation,
  type IndexKeeper
} from "./embedding-index";

/** A journal smaller than this never forces a compaction, however small the base. */
export const COMPACT_MIN_ROWS = 50;
/** The share of the base's rows a journal may reach before it is folded back in. */
export const COMPACT_SHARE = 0.05;

/**
 * Whether the journal has outgrown its base. Relative, because what a journal
 * costs to read on every launch grows with it while the base's rewrite costs the
 * same whatever it holds; floored, so a small vault is not rewritten for every
 * other edit.
 */
export function shouldCompact(journalRows: number, baseRows: number): boolean {
  return journalRows >= Math.max(COMPACT_MIN_ROWS, Math.ceil(baseRows * COMPACT_SHARE));
}

export interface JournalContent {
  /** The `writtenAt` of the base this journal extends. */
  base: number;
  upserts: IndexedConversation[];
  removed: string[];
  keeper?: IndexKeeper | undefined;
  writtenAt?: number | undefined;
}

export function serializeJournal(j: JournalContent, dim: number): ArrayBuffer {
  return serializeIndex(
    j.upserts,
    dim,
    { complete: false, scope: "", keeper: j.keeper, writtenAt: j.writtenAt },
    { journalOf: j.base, removed: j.removed }
  );
}

/** A journal read from disk, validated; null when it cannot vouch for itself. */
export function deserializeJournal(buf: ArrayBuffer, dim: number): JournalContent | null {
  try {
    const { items, dim: fileDim, meta, header } = deserializeIndex(buf);
    const base = readWrittenAt(header.journalOf);
    if (fileDim !== dim || base === undefined) return null;
    const removed = Array.isArray(header.removed)
      ? header.removed.filter((id): id is string => typeof id === "string")
      : [];
    return { base, upserts: items, removed, keeper: meta.keeper, writtenAt: meta.writtenAt };
  } catch {
    // A torn or foreign file is not a journal. Its notes answer from the base
    // until they are re-embedded, which is the same outcome as no journal.
    return null;
  }
}

/** The base's rows with the journal applied: upserts replace or add, removals drop. */
export function applyJournal(
  items: IndexedConversation[],
  j: Pick<JournalContent, "upserts" | "removed">
): IndexedConversation[] {
  const superseded = new Set([...j.removed, ...j.upserts.map((u) => u.id)]);
  return [...items.filter((i) => !superseded.has(i.id)), ...j.upserts];
}

/**
 * Journals laid over one another, oldest write first: a later entry for a note
 * replaces an earlier one. One writer's journals each hold all it wrote since
 * the base, so their merge is simply the newest; two writers' are a union.
 */
export function mergeJournals(journals: readonly JournalContent[]): JournalContent | null {
  const ordered = [...journals].sort((a, b) => (a.writtenAt ?? 0) - (b.writtenAt ?? 0));
  const last = ordered[ordered.length - 1];
  if (!last) return null;
  const upserts = new Map<string, IndexedConversation>();
  const removed = new Set<string>();
  for (const j of ordered) {
    for (const u of j.upserts) {
      upserts.set(u.id, u);
      removed.delete(u.id);
    }
    for (const id of j.removed) {
      upserts.delete(id);
      removed.add(id);
    }
  }
  return {
    base: last.base,
    upserts: [...upserts.values()],
    removed: [...removed],
    keeper: last.keeper,
    writtenAt: last.writtenAt
  };
}

/**
 * The journal of `base` on disk: the file and every conflict copy of it that
 * extends that base, merged. `copies` names every copy found, whatever it
 * held, since none of them is read by anything once this journal is written.
 * Throws when the file itself cannot be read; a copy that cannot is skipped.
 */
export async function readJournal(
  store: IndexStore,
  base: number,
  dim: number,
  logger: Pick<Logger, "warn">
): Promise<{ journal: JournalContent | null; copies: string[] }> {
  const buf = await store.read();
  const found: JournalContent[] = [];
  const own = buf ? deserializeJournal(buf, dim) : null;
  if (own) found.push(own);
  let copies: { name: string; read(): Promise<ArrayBuffer> }[] = [];
  try {
    copies = (await store.copies?.()) ?? [];
  } catch (e) {
    logger.warn("semantic index: the index journal's sync copies could not be listed", e);
  }
  for (const copy of copies) {
    try {
      const j = deserializeJournal(await copy.read(), dim);
      if (j) found.push(j);
    } catch (e) {
      logger.warn(`semantic index: the journal copy "${copy.name}" could not be read`, e);
    }
  }
  // A stale journal: see the header of the file.
  const current = found.filter((j) => j.base === base);
  return { journal: mergeJournals(current), copies: copies.map((c) => c.name) };
}

/** The journal of one index: what changed since its base, in memory and on disk. */
export class IndexJournal {
  private readonly upserts = new Map<string, IndexedConversation>();
  private readonly removed = new Set<string>();
  /** The base this journal extends; undefined when there is none it can name. */
  private base: number | undefined;
  /** Conflict copies found when the journal was read: no reader needs them
   *  once this journal's next write stands. */
  private copies: string[] = [];

  constructor(
    private readonly store: IndexStore,
    private readonly logger: Pick<Logger, "warn"> = createLogger(() => false)
  ) {}

  get rows(): number {
    return this.upserts.size + this.removed.size;
  }

  /** The edits held, to lay over another base. */
  content(): { upserts: IndexedConversation[]; removed: string[] } {
    return { upserts: [...this.upserts.values()], removed: [...this.removed] };
  }

  /** Whether this journal holds an entry for `id`. */
  has(id: string): boolean {
    return this.upserts.has(id) || this.removed.has(id);
  }

  /** Whether there is a base this journal can be written against. */
  get extendsBase(): boolean {
    return this.base !== undefined;
  }

  /** A base was written or loaded: the journal starts over against it. */
  reset(base: number | undefined): void {
    this.upserts.clear();
    this.removed.clear();
    this.base = base;
  }

  /** A row changed in memory: its new state, or `undefined` when it was dropped. */
  record(id: string, item: IndexedConversation | undefined): void {
    if (item) {
      this.upserts.set(id, item);
      this.removed.delete(id);
    } else {
      this.upserts.delete(id);
      this.removed.add(id);
    }
  }

  /** Whether the next write may go here rather than rewrite the base: there is a
   *  base to attach to (a file from before Pythia ADR-221 has no `writtenAt`), and the
   *  journal has not outgrown it. */
  canTake(baseRows: number): boolean {
    return this.base !== undefined && !shouldCompact(this.rows, baseRows);
  }

  async write(
    dim: number,
    sig: { keeper?: IndexKeeper | undefined; writtenAt?: number | undefined }
  ): Promise<void> {
    if (this.base === undefined) throw new Error("IndexJournal.write: no base to extend");
    await this.store.write(
      serializeJournal(
        {
          base: this.base,
          upserts: [...this.upserts.values()],
          removed: [...this.removed],
          ...sig
        },
        dim
      )
    );
    if (this.copies.length === 0 || !this.store.removeCopies) return;
    const copies = this.copies;
    this.copies = [];
    try {
      await this.store.removeCopies(copies);
    } catch (e) {
      // Left for the next launch to find again; they are only read, never trusted.
      this.logger.warn("semantic index: the index journal's sync copies could not be removed", e);
    }
  }

  /**
   * Read the journal on disk and apply it to a freshly loaded base. When it
   * extends that base, its entries become this journal's, so the next write
   * carries them forward instead of dropping them.
   */
  async load(
    base: number | undefined,
    items: IndexedConversation[],
    dim: number
  ): Promise<{
    items: IndexedConversation[];
    keeper?: IndexKeeper | undefined;
    writtenAt?: number | undefined;
  }> {
    this.reset(base);
    if (base === undefined) return { items };
    let read: Awaited<ReturnType<typeof readJournal>>;
    try {
      read = await readJournal(this.store, base, dim, this.logger);
    } catch (e) {
      this.logger.warn(
        "semantic index: the index journal could not be read — using the index without it",
        e
      );
      return { items };
    }
    this.copies = read.copies;
    const j = read.journal;
    if (!j) return { items };
    for (const u of j.upserts) this.upserts.set(u.id, u);
    for (const id of j.removed) this.removed.add(id);
    return { items: applyJournal(items, j), keeper: j.keeper, writtenAt: j.writtenAt };
  }
}
