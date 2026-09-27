import type { EmbeddingProvider } from "./embedding-provider";
import type { IndexStore } from "./index-store";
import {
  serializeIndex,
  deserializeIndex,
  EMPTY_INDEX_META,
  type IndexedConversation,
  type IndexKeeper,
  type IndexMeta
} from "./embedding-index";
import { hashPolicyFor, resolveRowHash, type HashPolicy } from "./row-provenance";
import { DEFAULT_EMBEDDING_MODEL_ID } from "./embedding-models";
import { quantize, cosine, maxPairwiseCosine } from "./vector-math";
import { vaultNoteChunks, type RetrievedNote } from "./vault-retrieval";
import { IndexJournal, applyJournal, deserializeJournal } from "./index-journal";
import { isOutOfMemoryError } from "./memory-error";
import { createLogger, type Logger } from "../logger";

/** Notes processed between cooperative yields during a build (keeps the UI alive). */
const YIELD_EVERY_NOTES = 8;
/** Items scored between cooperative yields during a query rank (Pythia ADR-120). */
const RANK_YIELD_EVERY = 2000;
/**
 * Notes EMBEDDED between persists during a build (Pythia ADR-182).
 *
 * Before this, `doSync` wrote ONCE, after the last note. Anything that stopped a
 * build — a quit, a plugin reload, a renderer crash, one note throwing — threw
 * away every vector computed in that pass, so a vault whose build could not
 * finish in a single sitting never got an index at all, no matter how many times
 * it was attempted. `ConversationIndexService` commits on abort, but a crash is
 * not an abort, so "resumable" has to mean "already on disk", not "flushed on the
 * way out". 25 embeds is a few seconds of work against a multi-MB write, and an
 * incremental re-sync that embeds nothing still writes nothing.
 */
const PERSIST_EVERY_EMBEDS = 25;
/**
 * Floor on how often a build may rewrite the index, whatever the embed count
 * says (Pythia ADR-182).
 *
 * Every persist serializes the WHOLE index — ~19 MB at the 5 000-note cap — which
 * is the cost Pythia ADR-122 exists to avoid paying per note. Embeds alone would mean
 * ~200 full rewrites on a cold build at that size, and on a synced vault every
 * one of them is a sync event. Both conditions must hold, so the binding one is
 * whichever is scarcer: on a slow build that is the embed count, on a fast one
 * the clock. Either way the loss window stays ~30s of work, and the write rate
 * stays under 2/min. A BUILD still writes the whole index this way; edits go to
 * the journal instead (Pythia ADR-222, `indexJournal.ts`).
 */
const MIN_PERSIST_INTERVAL_MS = 30_000;
// The same floor holds for the watcher's edit batches (Pythia ADR-220). Pythia ADR-122 made a
// batch cost one write instead of one per note, but a batch arrived every couple
// of seconds while someone typed, and each one serialized the whole index again —
// ~19 MB allocated and written per flush, on a phone next to a loaded model, is
// what reloaded Obsidian mid-sentence. The first batch after a quiet spell still
// writes at once; batches inside the window stay in memory and one trailing write
// carries them all. What an app killed inside the window loses is those notes'
// new vectors: their old rows stay, their content hash no longer matches, and the
// next edit of each re-embeds it. Since Pythia ADR-222 an edit writes the journal —
// kilobytes — so the window now mostly saves sync events, not memory.
/**
 * Consecutive embed failures that mean the BACKEND is gone, not that one note is
 * bad (Pythia ADR-182).
 *
 * Skipping a note whose embed fails is what stops a single huge note from
 * costing the whole build — but applied blindly it turns an unloaded provider or
 * a crashed worker into a "successful" build that silently indexed almost
 * nothing and then reported itself ready. One note failing is data; five in a row
 * is the runtime. The run stops, keeps what it has, and rethrows.
 */
const MAX_CONSECUTIVE_EMBED_FAILURES = 5;

/**
 * Passages sent to the model in one request.
 *
 * A note used to go as ONE request, whatever its length, under one fixed
 * deadline. The model works through a request sixteen passages at a time
 * anyway, so a note of a thousand passages was sixty-odd inferences racing a
 * deadline sized for a few — it timed out, was skipped, and was tried again
 * from the start by every later build, paying the whole deadline each time.
 * One request per model batch gives every request the same small amount of
 * work, and lets a search's query slip in between two of them.
 */
export const EMBED_REQUEST_CHUNKS = 16;

/** How a build ended. */
export interface SyncResult {
  /** Notes embedded (not reused) in this pass. */
  embedded: number;
  /** The pass stopped at its `maxEmbeds` budget before reaching every note. */
  stopped: boolean;
}

/** What a build may do beyond the defaults. */
export interface SyncOptions {
  /** Stop after embedding this many notes, keeping them (0 or absent: no limit). */
  maxEmbeds?: number;
  /** Before each write, take rows another device wrote since this pass loaded,
   *  for the notes this pass has not reached. See `doSync`. */
  mergeFromStore?: boolean;
}

/** A vault note to index: its path (the index id) and a LAZY content loader.
 *  Content is loaded one note at a time during sync and released immediately, so
 *  peak memory is bounded regardless of vault size (Pythia ADR-120) — never the whole
 *  vault's text at once. */
export interface IndexableNote {
  path: string;
  load: () => Promise<string>;
}

/**
 * Keeps a vector index of the vault's notes in sync and answers semantic
 * retrieval queries for vault-wide RAG (Pythia ADR-116/118/119/120).
 *
 * STREAMED build (Pythia ADR-120): notes are read + chunked + embedded ONE AT A TIME
 * and their text released before the next, so a 30k-note vault does not hold
 * ~all its content in memory at once. Only new / content-changed notes are
 * re-embedded (per-note content-hash compare), removed notes drop out, and the
 * packed index is persisted through the injected store.
 *
 * Both the embedding provider and the store are interfaces, so the whole
 * orchestration is unit-tested with fakes. The note index is stored under a
 * separate key from the conversation index (VaultIndexStore's `prefix`).
 */
/** Warnings still reach the console when no logger was handed in. */
const FALLBACK_LOGGER = createLogger(() => false);

export class VaultIndexService {
  private items: IndexedConversation[] = [];
  private loaded = false;
  /** What the persisted index says about ITSELF (Pythia ADR-184) — whether the build
   *  that wrote it finished, and the scope its rows were selected under. */
  private meta: IndexMeta = EMPTY_INDEX_META;
  /** Serializes all mutations (sync / updateNote / removeNote / clear) so they
   *  never interleave — a targeted edit can't race a full build (Pythia ADR-121). */
  private chain: Promise<unknown> = Promise.resolve();
  private synced = false;
  /** The rows a build in progress would write now, for a query that cannot
   *  wait for the build to end. Null while no build runs. */
  private live: (() => IndexedConversation[]) | null = null;
  /** When an edit batch last wrote the index, and the trailing write that is
   *  holding the batches since (Pythia ADR-220). */
  private lastEditWriteAt = Number.NEGATIVE_INFINITY;
  private pendingEditWrite: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly store: IndexStore,
    /** `persistIntervalMs` overrides MIN_PERSIST_INTERVAL_MS — a test seam, so the
     *  mid-build flush can be exercised without a fake clock (a real build's
     *  embeds take seconds; a fake provider's take microseconds). */
    private readonly opts: {
      maxChars?: number;
      persistIntervalMs?: number;
      hashPolicy?: HashPolicy;
      /** Where a recoverable problem is reported. */
      logger?: Pick<Logger, "warn">;
      /** The kind of device this runs on, stamped on every write (Pythia ADR-221). */
      device?: IndexKeeper;
    } = {}
  ) {
    this.journal = store.journal ? new IndexJournal(store.journal(), this.logger) : null;
  }

  /** Where edits go instead of a base rewrite, when the store has one (Pythia ADR-222). */
  private readonly journal: IndexJournal | null;

  /** Write the whole index — the base — and start the journal over against it. */
  private async writeBase(items: IndexedConversation[], meta: IndexMeta): Promise<void> {
    await this.store.write(serializeIndex(items, this.provider.dim, meta));
    this.journal?.reset(meta.writtenAt);
    this.baseStamp = meta.writtenAt;
  }

  /** The `writtenAt` of the base file this instance last read or wrote — the
   *  base's own, never the journal's, so it compares with `peekIndexMeta`. */
  private baseStamp: number | undefined;

  /**
   * Whether the base file on disk, as `peekIndexMeta` read it, is another one
   * than the base this instance holds. Compared for identity, not order: the
   * stamps come from two devices' clocks, and a desktop whose clock runs behind
   * the phone's still wrote the newer file.
   */
  baseDiffersFrom(writtenAt: number | undefined): boolean {
    return writtenAt !== undefined && writtenAt !== this.baseStamp;
  }

  private get logger(): Pick<Logger, "warn"> {
    return this.opts.logger ?? FALLBACK_LOGGER;
  }

  private get device(): IndexKeeper {
    return this.opts.device ?? "desktop";
  }

  /** What a write records about itself: the meta, signed by this device (Pythia ADR-221). */
  private stamp(meta: IndexMeta): IndexMeta {
    return { ...meta, keeper: this.device, writtenAt: Date.now() };
  }

  /** Which kind of device last wrote the index, and when, as far as this
   *  instance knows — for the settings status line (Pythia ADR-221). */
  signature(): { keeper?: IndexKeeper; writtenAt?: number } {
    const { keeper, writtenAt } = this.meta;
    return { ...(keeper ? { keeper } : {}), ...(writtenAt ? { writtenAt } : {}) };
  }

  /**
   * Whether this device writes its edits to the shared file (Pythia ADR-221).
   *
   * A phone does not rewrite an index a desktop keeps. It still applies its own
   * edits in memory, so its answers see them this session, and the desktop
   * re-embeds those notes when their change reaches it — through the watcher
   * while it runs, or its catch-up at the next launch. What the phone saves is
   * the whole-file write (~19 MB at the cap) and the two devices overwriting
   * each other's copy of one synced file.
   */
  private writesEdits(): boolean {
    return !(this.device === "mobile" && this.meta.keeper === "desktop");
  }

  /** Which stored rows this device may reuse (Pythia ADR-201). */
  private get policy(): HashPolicy {
    return this.opts.hashPolicy ?? hashPolicyFor(DEFAULT_EMBEDDING_MODEL_ID);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn); // run regardless of the prior op's outcome
    this.chain = run.then(
      () => undefined,
      () => undefined
    ); // keep the chain alive on error
    return run;
  }

  /** Number of notes the index can answer for (for status). A note whose embed
   *  failed is held as an empty row so it is not retried until it changes, and
   *  is not counted. */
  size(): number {
    return this.items.reduce((n, item) => n + (item.chunks.length > 0 ? 1 : 0), 0);
  }

  /**
   * Whether `query` answers now: the index is ready, or a build is running over
   * rows that are already there. A first build of a large vault takes a while,
   * and search by meaning used to answer nothing at all until its very last
   * note — the index grew for an hour and none of it could be found.
   */
  isQueryable(): boolean {
    return this.synced || this.live !== null;
  }

  /** Wipe the index (in-memory + persisted) and mark it not-ready, so the next
   *  sync re-embeds every note from scratch. Backs the "reindex" action (Pythia ADR-119). */
  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.cancelPendingEditWrite(); // the edits it held are being wiped with everything else
      this.items = [];
      this.synced = false;
      this.meta = this.stamp(EMPTY_INDEX_META);
      this.loaded = true; // don't let a later load() repopulate from the old store
      await this.writeBase([], this.meta);
    });
  }

  /** True once at least one sync has completed — i.e. the model is loaded and the
   *  index is populated, so `query` can run fast (only the query is embedded).
   *  Retrieval is gated on this so a turn never waits on the first-use model
   *  download / whole-vault embedding (Pythia ADR-118). */
  isReady(): boolean {
    return this.synced;
  }

  /**
   * Whether a build has ever run to COMPLETION for `scope` (Pythia ADR-184).
   *
   * `isReady()` only says the index can answer a query — hydrating a persisted
   * file sets it, and since Pythia ADR-182 that file may be a fifth of a build that was
   * interrupted. Anything deciding whether to BUILD must ask this instead, or a
   * partial index reports itself finished and is never resumed.
   *
   * A scope that differs from the one the rows were selected under is also not
   * complete: narrowing the folders has to drop what is now outside them, and
   * only a rebuild does that.
   */
  isComplete(scope: string): boolean {
    return this.meta.complete && this.meta.scope === scope;
  }

  /** The scope the persisted rows were selected under, for diagnostics. */
  indexedScope(): string {
    return this.meta.scope;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const buf = await this.store.read();
    if (buf) {
      try {
        const { items, dim, meta } = deserializeIndex(buf);
        this.baseStamp = meta.writtenAt;
        // A dim mismatch means a different model built the index — drop it and
        // let the next sync rebuild from scratch.
        if (dim === this.provider.dim) {
          const merged = this.journal
            ? await this.journal.load(meta.writtenAt, items, dim)
            : { items };
          this.items = merged.items;
          this.meta = {
            ...meta,
            ...(merged.keeper ? { keeper: merged.keeper } : {}),
            ...(merged.writtenAt ? { writtenAt: merged.writtenAt } : {})
          };
        }
      } catch (e) {
        // A corrupt or truncated file (an interrupted write, a half-synced
        // iCloud copy) is not fatal: an empty index rebuilds on the next sync.
        // Logged rather than swallowed (principle 2) — this is the only place
        // that can report it, and it would otherwise show up as a silent
        // whole-vault re-embed.
        this.logger.warn("semantic index: the stored index could not be read — rebuilding it", e);
        this.items = [];
        this.meta = EMPTY_INDEX_META;
      }
    }
    this.loaded = true;
  }

  /** Bring the index in line with `notes` (full build / manual reindex). Serialized
   *  behind the op chain. `onProgress` (processed, total) fires as notes are handled.
   *  `throttle` controls how hard the build yields the thread: on a UI-thread backend
   *  (no Worker) pass a fine cadence + a breather so a large build never freezes the
   *  app (Pythia ADR-125). Defaults keep the off-thread cadence. */
  sync(
    notes: IndexableNote[],
    onProgress?: (processed: number, total: number) => void,
    throttle: { yieldEveryNotes?: number; breatherMs?: number } = {},
    /** The scope these notes were selected under, recorded so a later session
     *  can tell whether the index still matches the settings (Pythia ADR-184). */
    scope = "",
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    return this.enqueue(() => this.doSync(notes, onProgress, throttle, scope, options));
  }

  /**
   * Hydrate the index from persisted storage and mark it queryable WITHOUT
   * embedding any notes. For environments that have no off-thread embedding
   * backend (Obsidian mobile: the Web Worker blob is blocked, so a full build
   * would run hundreds of inferences on the UI thread and freeze the app). A
   * `query` embeds only the query string — cheap even on the main thread — so
   * retrieval works against an index that was built and synced from desktop. If
   * nothing is persisted (or it's from a different model), the index stays empty
   * and queries return []. Never re-embeds a note.
   */
  hydrateForQuery(): Promise<void> {
    return this.enqueue(async () => {
      await this.load();
      this.synced = true; // queryable against whatever loaded (possibly empty)
    });
  }

  /**
   * Read the persisted index again, replacing what this instance holds, and
   * keep answering from it. For a phone, which does not keep the index but
   * reads it: a desktop still building writes more of it every half minute,
   * and a phone that read it once at launch answered from that copy all day.
   * Edits held in memory (Pythia ADR-221) are dropped with it; the desktop
   * re-embeds those notes when their change reaches it.
   */
  reload(): Promise<void> {
    return this.enqueue(async () => {
      if (this.cancelPendingEditWrite()) await this.writeEdits();
      this.loaded = false;
      this.items = [];
      this.meta = EMPTY_INDEX_META;
      await this.load();
      this.synced = true;
    });
  }

  /** Read the persisted index WITHOUT making it queryable (Pythia ADR-221), so the
   *  catch-up can ask `isComplete` of an index it may then leave alone. Marking
   *  an unfinished index ready would stop the next send from resuming its build. */
  loadPersisted(): Promise<void> {
    // Already read: nothing to wait for. Joining the queue would put a caller
    // that only wants the rows (the Recommended panel) behind a whole build.
    if (this.loaded) return Promise.resolve();
    return this.enqueue(() => this.load());
  }

  /**
   * Targeted incremental update of a SINGLE note (Pythia ADR-121) — re-embed it if its
   * content changed, add it if new, drop it if now empty/unreadable. No-ops unless
   * the index is already built (`isReady`); a not-yet-built index is handled by a
   * full `sync`. `cap` (when > 0) prevents ADDING a new note past the note cap.
   * This is what the vault watcher calls on an edit, so a single note change costs
   * one embed instead of rescanning the whole corpus.
   */
  updateNote(note: IndexableNote, opts: { cap?: number } = {}): Promise<void> {
    return this.applyBatch({ updates: [note], removes: [] }, opts);
  }

  /** Targeted removal of a single note from the index (delete / moved out of scope). */
  removeNote(path: string): Promise<void> {
    return this.applyBatch({ updates: [], removes: [path] }, {});
  }

  /**
   * Apply a BATCH of targeted changes with a SINGLE persist (Pythia ADR-122): removes,
   * then updates (re-embed changed, add new within `cap`, drop emptied/unreadable).
   * All mutations are made in memory and the index is serialized + written at most
   * ONCE — so the watcher flushing N edited notes costs one `.bin` write, not N.
   * No-ops until the index is built (`isReady`).
   */
  applyBatch(
    changes: { updates: IndexableNote[]; removes: string[] },
    opts: { cap?: number } = {}
  ): Promise<void> {
    return this.enqueue(() => this.doApplyBatch(changes, opts));
  }

  private async doApplyBatch(
    changes: { updates: IndexableNote[]; removes: string[] },
    opts: { cap?: number }
  ): Promise<void> {
    await this.load();
    if (!this.synced) return; // patch only a built index; a full build handles the rest
    let dirty = false;
    // Each row that moves is recorded for the journal (Pythia ADR-222): its new state, or
    // its removal when an update dropped it.
    const note = (path: string): void =>
      this.journal?.record(
        path,
        this.items.find((i) => i.id === path)
      );
    for (const path of changes.removes)
      if (this.removeInMemory(path)) {
        dirty = true;
        note(path);
      }
    let n = 0;
    for (const update of changes.updates) {
      if (await this.updateInMemory(update, opts.cap)) {
        dirty = true;
        note(update.path);
      }
      if (++n % YIELD_EVERY_NOTES === 0) await new Promise((r) => setTimeout(r, 0));
    }
    // Targeted edits keep whatever the index already claims about itself: a
    // watcher flush neither completes an unfinished build nor invalidates a
    // finished one.
    // A phone holding a desktop's index keeps the edit in memory only (Pythia ADR-221);
    // nothing is lost that the desktop does not redo, so no word is owed.
    if (dirty && this.writesEdits()) await this.persistEdits();
  }

  /** Write an edit batch now, or leave it to the window's trailing write (Pythia ADR-220).
   *  Runs inside the op chain, so the trailing write is enqueued rather than run
   *  from the timer — it must not interleave with a build. */
  private async persistEdits(): Promise<void> {
    const interval = this.opts.persistIntervalMs ?? MIN_PERSIST_INTERVAL_MS;
    const wait = this.lastEditWriteAt + interval - Date.now();
    if (wait <= 0) {
      this.cancelPendingEditWrite();
      await this.writeEdits();
      return;
    }
    if (this.pendingEditWrite) return; // one trailing write carries every batch in the window
    this.pendingEditWrite = setTimeout(() => {
      this.pendingEditWrite = null;
      void this.enqueue(() => this.writeEdits());
    }, wait);
  }

  private async writeEdits(): Promise<void> {
    this.lastEditWriteAt = Date.now();
    this.meta = this.stamp(this.meta);
    // Kilobytes to the journal while it is small; the base only to fold it in.
    if (this.journal?.canTake(this.items.length))
      return this.journal.write(this.provider.dim, this.meta);
    await this.writeBase(this.items, this.meta);
  }

  private cancelPendingEditWrite(): boolean {
    if (!this.pendingEditWrite) return false;
    clearTimeout(this.pendingEditWrite);
    this.pendingEditWrite = null;
    return true;
  }

  /** Write edits still held by the window now — the plugin is unloading, and a
   *  timer does not outlive it (Pythia ADR-220). */
  flushPendingWrites(): Promise<void> {
    return this.enqueue(async () => {
      if (this.cancelPendingEditWrite()) await this.writeEdits();
    });
  }

  /** Re-embed / add / drop a single note IN MEMORY (no persist). Returns whether
   *  the index changed. Empty/unreadable content drops the note. */
  private async updateInMemory(note: IndexableNote, cap?: number): Promise<boolean> {
    const maxChars = this.opts.maxChars ?? 500;
    let chunks: string[];
    try {
      chunks = vaultNoteChunks(await note.load(), maxChars);
    } catch {
      return this.removeInMemory(note.path); // unreadable → drop
    }
    if (chunks.length === 0) return this.removeInMemory(note.path); // emptied → drop

    const idx = this.items.findIndex((i) => i.id === note.path);
    const { hash, reuse } = resolveRowHash(
      this.policy,
      idx >= 0 ? this.items[idx]?.contentHash : undefined,
      chunks
    );
    if (reuse) return false; // unchanged (or a row this device accepts — Pythia ADR-201)
    if (idx < 0 && cap && cap > 0 && this.items.length >= cap) return false; // cap new adds

    const raw = await this.embedAll(chunks);
    const item = { id: note.path, contentHash: hash, chunks: raw.map(quantize) };
    if (idx >= 0) this.items[idx] = item;
    else this.items.push(item);
    return true;
  }

  /**
   * Whether a failed embed is held as a row without vectors, so it is not
   * tried again until the note changes.
   *
   * Not a deadline: a request that ran out of time may only have been slow —
   * a busy machine, an app sent to the background — and a note remembered as
   * failed for that would stay out of the index until someone edited it. And
   * never on a phone: the row goes into the file the desktop keeps, and a
   * note too much for a phone would then be skipped by the desktop too.
   */
  private remembersFailure(e: unknown): boolean {
    if (this.device === "mobile") return false;
    const message = e instanceof Error ? e.message : String(e);
    return !/timed? ?out/i.test(message);
  }

  /** Embed a note's passages one model batch per request (EMBED_REQUEST_CHUNKS). */
  private async embedAll(chunks: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_REQUEST_CHUNKS) {
      const batch = chunks.slice(i, i + EMBED_REQUEST_CHUNKS);
      const vectors = await this.provider.embed(batch);
      if (vectors.length !== batch.length) {
        throw new Error(`embed: ${batch.length} passages returned ${vectors.length} vectors`);
      }
      out.push(...vectors);
    }
    return out;
  }

  /**
   * The rows on disk now, base and journal, or null when there are none this
   * instance can read. For a phone's build, which must not overwrite what a
   * desktop wrote while it ran (see `doSync`).
   */
  private async readStoreRows(): Promise<Map<string, IndexedConversation> | null> {
    try {
      const buf = await this.store.read();
      if (!buf) return null;
      const { items, dim, meta } = deserializeIndex(buf);
      if (dim !== this.provider.dim) return null;
      let rows = items;
      const journalBuf = meta.writtenAt ? await this.store.journal?.().read() : null;
      const journal = journalBuf ? deserializeJournal(journalBuf, dim) : null;
      if (journal && journal.base === meta.writtenAt) rows = applyJournal(rows, journal);
      return new Map(rows.map((row) => [row.id, row]));
    } catch (e) {
      this.logger.warn("semantic index: could not read the stored index to merge it", e);
      return null;
    }
  }

  /** Drop a note from the in-memory index (no persist). Returns whether it changed. */
  private removeInMemory(path: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== path);
    return this.items.length !== before;
  }

  private async doSync(
    notes: IndexableNote[],
    onProgress?: (processed: number, total: number) => void,
    throttle: { yieldEveryNotes?: number; breatherMs?: number } = {},
    scope = "",
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    await this.load();
    const maxChars = this.opts.maxChars ?? 500;
    const yieldEvery = Math.max(1, throttle.yieldEveryNotes ?? YIELD_EVERY_NOTES);
    const breatherMs = Math.max(0, throttle.breatherMs ?? 0);
    const maxEmbeds = Math.max(0, options.maxEmbeds ?? 0);

    // Reuse unchanged vectors by (path → item); rebuild the survivor list in
    // note order. `kept` holds only Int8 vectors (the index we need anyway);
    // note text and chunk strings are held only for the note being processed.
    const existing = new Map(this.items.map((i) => [i.id, i]));
    const kept: IndexedConversation[] = [];
    /** Every note this pass has finished with, INCLUDING ones it dropped: a
     *  mid-build snapshot must not resurrect a note it just decided to drop. */
    const handled = new Set<string>();
    const desired = new Set(notes.map((n) => n.path));
    const total = notes.length;
    let embedded = 0;
    /** Notes held as failed (a row without vectors) in `kept` right now. */
    let failed = 0;
    let processed = 0;
    /** `embedded + failed` as of the last write: whether there is anything new
     *  to write is a question about both. */
    let persistedChanges = 0;
    const changes = (): number => embedded + failed;
    let failedInARow = 0;
    /** Notes given up on since the last success. If the streak turns out to be
     *  a dead backend rather than bad notes, they were never judged and must
     *  not be remembered as failed. */
    let streak: string[] = [];
    let stopped = false;
    let lastPersistAt = Date.now();
    const persistIntervalMs = this.opts.persistIntervalMs ?? MIN_PERSIST_INTERVAL_MS;

    // A mid-build snapshot = what this pass has rebuilt so far, PLUS the notes it
    // has not reached yet whose vectors are still valid. Persisting only `kept`
    // would make every interrupted build delete the tail of its own index.
    //
    // Reads `existing` — captured once, before the loop — rather than `this.items`,
    // which `persist` reassigns. `existing` is immutable for the length of the
    // build, so the snapshot cannot depend on what `persist` does to the live field.
    //
    // `fresher` is what the store holds now, when the pass was asked to merge
    // (a phone, see below): for a note this pass has not reached, the store's
    // row is newer than the one loaded when the pass began.
    const snapshot = (fresher?: Map<string, IndexedConversation> | null): IndexedConversation[] => {
      const rest: IndexedConversation[] = [];
      const pending = new Set<string>();
      for (const item of existing.values()) {
        if (handled.has(item.id) || !desired.has(item.id)) continue;
        rest.push(fresher?.get(item.id) ?? item);
        pending.add(item.id);
      }
      if (fresher) {
        for (const [id, item] of fresher) {
          if (!handled.has(id) && desired.has(id) && !pending.has(id)) rest.push(item);
        }
      }
      return [...kept, ...rest];
    };
    // Memory follows disk. Without the assignment the two diverge the moment a
    // build is interrupted: `load()` is a no-op once `loaded` is set, so the NEXT
    // sync on this same instance would rebuild `existing` from the stale
    // pre-sync list and re-embed everything the failed pass had just persisted.
    // A mid-build write is explicitly INCOMPLETE: the rows are worth keeping, and
    // the next session must still know the build never finished.
    //
    // A phone's pass merges before it writes. It loaded the file when it began;
    // a desktop building meanwhile has written rows since, and writing the
    // phone's snapshot as it stood would throw that desktop's work away — the
    // two devices undoing each other through one synced file.
    // `final` is the finished list; without it, the snapshot of a pass still
    // under way is written.
    const persist = async (
      final: IndexedConversation[] | null,
      complete: boolean
    ): Promise<void> => {
      const rows = final ?? snapshot(options.mergeFromStore ? await this.readStoreRows() : null);
      const meta = this.stamp({ complete, scope });
      await this.writeBase(rows, meta);
      this.items = rows;
      this.meta = meta;
      persistedChanges = changes();
      lastPersistAt = Date.now();
    };

    this.live = () => snapshot();
    try {
      for (const note of notes) {
        processed++;
        handled.add(note.path);
        let chunks: string[];
        try {
          chunks = vaultNoteChunks(await note.load(), maxChars);
        } catch {
          onProgress?.(processed, total);
          continue; // unreadable note — skip (drops it from the index if it was there)
        }
        if (chunks.length === 0) {
          onProgress?.(processed, total);
          continue;
        } // empty note

        const prev = existing.get(note.path);
        const { hash, reuse } = resolveRowHash(this.policy, prev?.contentHash, chunks);
        if (prev && reuse) {
          kept.push(prev); // unchanged (or failed before, unchanged) — no re-embed
          // Resets the failure streak too. Not resetting here would let five
          // bad notes SCATTERED through a mostly-unchanged vault abort the
          // build — reinstating the very bug this guard sits next to. A dead
          // backend still trips it, because a cold build embeds every note.
          failedInARow = 0;
          streak = [];
        } else if (maxEmbeds > 0 && embedded + failed >= maxEmbeds) {
          // Out of budget. The pass goes on through the notes it can reuse and
          // past the ones that are gone; this one keeps whatever row it had.
          handled.delete(note.path);
          stopped = true;
        } else {
          try {
            const raw = await this.embedAll(chunks);
            kept.push({ id: note.path, contentHash: hash, chunks: raw.map(quantize) });
            embedded++;
            failedInARow = 0;
            streak = [];
          } catch (e) {
            // ONE note must not cost the build (Pythia ADR-182): drop it, say so,
            // carry on — until it stops looking like one bad note and starts
            // looking like a dead backend.
            this.logger.warn(`semantic index: skipping "${note.path}" — embed failed`, e);
            if (isOutOfMemoryError(e) || ++failedInARow >= MAX_CONSECUTIVE_EMBED_FAILURES) {
              // Not the notes' fault: the ones this streak gave up on go back
              // to what they were, to be tried again by the next build.
              for (const path of streak) {
                handled.delete(path);
                const at = kept.findIndex((row) => row.id === path);
                if (at >= 0) {
                  kept.splice(at, 1);
                  failed--;
                }
              }
              handled.delete(note.path);
              throw e;
            }
            streak.push(note.path);
            if (this.remembersFailure(e)) {
              // Remembered as failed: a row with no vectors under this content's
              // hash, so the next build reuses the failure instead of paying for
              // it again. An edit changes the hash and the note is tried anew.
              kept.push({ id: note.path, contentHash: hash, chunks: [] });
              failed++;
            } else {
              // Tried again by the next build, with whatever row it had.
              handled.delete(note.path);
            }
          }
        }
        onProgress?.(processed, total);
        // Flush what is embedded so far, so an interruption costs at most the
        // last few notes instead of the entire build (Pythia ADR-182). Counted in
        // EMBEDS, not notes processed: the `continue` paths above (unreadable,
        // empty) jump past this check, so a modulus on `processed` could stride
        // over the flush point and skip it.
        // Never inside a failure streak: if it ends as a dead backend, the
        // failures it held are taken back, and a write would have kept them.
        if (
          streak.length === 0 &&
          changes() - persistedChanges >= PERSIST_EVERY_EMBEDS &&
          Date.now() - lastPersistAt >= persistIntervalMs
        ) {
          await persist(null, false);
        }
        // Cooperative yield: on the UI-thread (iframe) backend, embedding runs on the
        // renderer thread, so hand control back — finely, with a breather (Pythia ADR-125) —
        // so a large build never freezes the app. Off-thread, the coarse default is fine.
        if (processed % yieldEvery === 0) await new Promise((r) => setTimeout(r, breatherMs));
      }
    } catch (e) {
      // Abort, unload, anything else: keep the work rather than the tidiness.
      // The rescue write gets its own guard — if the STORE is what failed (a full
      // disk, an evicted iCloud file), retrying it here would replace the real
      // cause with a duplicate of itself and lose the diagnosis.
      if (changes() > persistedChanges) {
        try {
          await persist(null, false);
        } catch (writeErr) {
          this.logger.warn("semantic index: could not persist partial index", writeErr);
        }
      }
      this.live = null;
      throw e;
    }
    this.live = null;

    if (stopped) {
      // Out of budget: what was embedded is kept, and the index says it is
      // unfinished, so the device that keeps it carries on from here.
      const gone = [...existing.keys()].some((id) => !desired.has(id));
      if (changes() > persistedChanges || gone || options.mergeFromStore)
        await persist(null, false);
      else this.items = snapshot();
      this.synced = true;
      return { embedded, stopped };
    }

    // Persist when the index changed (an embed since the last flush, or a note
    // present before is gone) — and ALSO when the file on disk does not yet say
    // this scope is complete, because that flag is the whole answer to "must I
    // build?" and a no-op sync is exactly when it is most likely to be wrong.
    // The snapshot, not `kept` alone: a note that failed without being
    // remembered (a deadline) keeps the row it had until a build gets through.
    const final = snapshot();
    const finalIds = new Set(final.map((row) => row.id));
    const dropped = [...existing.keys()].some((id) => !finalIds.has(id));
    this.items = final;
    const changed = changes() > persistedChanges || dropped;
    // …and when another kind of device signed it: a full sync is how a device
    // takes the index over (a phone's Build now, a desktop's catch-up), and an
    // unchanged index it does not sign stays the other device's (Pythia ADR-221).
    if (
      changed ||
      !this.meta.complete ||
      this.meta.scope !== scope ||
      this.meta.keeper !== this.device
    ) {
      await persist(final, true);
    }
    this.synced = true;
    return { embedded, stopped };
  }

  /** The stored vectors of one note, or null when it is not in the index. */
  vectorsOf(path: string): Int8Array[] | null {
    const item = this.items.find((i) => i.id === path);
    return item && item.chunks.length > 0 ? item.chunks : null;
  }

  /**
   * The indexed notes most like `chunks` — another note's stored vectors — best
   * first. Nothing is embedded, so this never needs the model: it is what lets
   * the Recommended panel follow the open note on a phone that released it.
   */
  async rankByVectors(
    chunks: readonly Int8Array[],
    opts: { minScore: number; limit: number; exclude?: Iterable<string> }
  ): Promise<RetrievedNote[]> {
    // Whatever is loaded answers, finished or not: a partial index still knows
    // which of its notes are alike, and asking does not mark it ready.
    if (chunks.length === 0) return [];
    const excluded = new Set(opts.exclude ?? []);
    const source = [...chunks];
    const scored: RetrievedNote[] = [];
    let scanned = 0;
    for (const item of this.items) {
      if (item.chunks.length > 0 && !excluded.has(item.id)) {
        const score = maxPairwiseCosine(source, item.chunks);
        if (Number.isFinite(score) && score >= opts.minScore) scored.push({ id: item.id, score });
      }
      if (++scanned % RANK_YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.limit);
  }

  /**
   * Rank the ALREADY-INDEXED notes against `query`, most-relevant first. Embeds
   * only the query (fast — the model is loaded once the index is ready), never
   * the vault, so it is safe to await inside a chat turn. Ranking scans the index
   * COOPERATIVELY (yielding every few thousand notes) so a large corpus never
   * blocks the UI thread in one burst (Pythia ADR-120). Returns [] when the index isn't
   * ready or nothing clears the floor; `exclude` paths are dropped before `limit`.
   */
  async query(
    text: string,
    opts: { minScore?: number; limit?: number; exclude?: Iterable<string> } = {}
  ): Promise<RetrievedNote[]> {
    const q = text.trim();
    if (!q || !this.isQueryable()) return [];
    // During a build, the rows it has so far; they are what a write would keep.
    const rows = this.synced && !this.live ? this.items : (this.live?.() ?? this.items);
    if (rows.length === 0) return [];
    const [raw] = await this.provider.embed([q]);
    if (!raw) return [];
    const queryVec = quantize(raw);
    const minScore = opts.minScore ?? 0.35;
    const excluded = new Set(opts.exclude ?? []);

    const scored: RetrievedNote[] = [];
    let scanned = 0;
    for (const item of rows) {
      if (item.chunks.length > 0 && !excluded.has(item.id)) {
        let best = -Infinity;
        for (const chunk of item.chunks) {
          const s = cosine(chunk, queryVec);
          if (s > best) best = s;
        }
        if (Number.isFinite(best) && best >= minScore) scored.push({ id: item.id, score: best });
      }
      if (++scanned % RANK_YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
    }
    scored.sort((a, b) => b.score - a.score);
    return typeof opts.limit === "number" ? scored.slice(0, opts.limit) : scored;
  }
}
