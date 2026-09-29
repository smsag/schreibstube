/**
 * The words of every note's text, kept so the Explorer filter can match them.
 *
 * Laid out as a vocabulary rather than as a word list per note. Across a vault
 * the same few tens of thousands of words recur in every note, so each note
 * holds numbers into one shared list instead of strings of its own — the
 * difference between megabytes and a phone's worth of memory at the note cap.
 * It is also what makes a keystroke cheap: a typed word is compared against
 * each *distinct* word once, and every note then only looks up its numbers.
 *
 * Reading the notes is the slow half and happens once: `BodyLoader` fills the
 * index in the background the first time the filter is used, a few notes at a
 * time, and re-reads a single note when the vault says it changed.
 *
 * Nothing here knows what Obsidian is; the view supplies a way to list and
 * read notes.
 */
import { forwardMatchStrength, tokenize, type BodyMatcher } from "./file-search";
import { MAX_NOTE_CHARS, plainNoteText } from "./note-text";

/** The most distinct words one note contributes. A note with more is an export
 *  or a list of data, and its first words already carry what it is about. */
export const MAX_BODY_TOKENS = 5_000;

/**
 * The most words the shared vocabulary holds before it is rebuilt from the
 * notes still in it. Words of deleted or rewritten notes stay in the
 * vocabulary until then — harmless, since nothing points at them, but not
 * free — so this is the bound on that garbage.
 */
export const MAX_VOCABULARY = 400_000;

/**
 * Words whose answers are kept between draws. The pane draws again on every
 * vault event while a filter is set — every autosave — and each draw asked the
 * same few words again, a walk over the whole vocabulary and every note each
 * time. The answers are kept, and patched per note as notes change; they hold
 * paths rather than word numbers, so a compaction leaves them right.
 */
const CACHED_WORDS = 32;

export class BodyIndex implements BodyMatcher {
  private vocabulary = new Map<string, number>();
  private words: string[] = [];
  private readonly notes = new Map<string, Uint32Array>();
  /** The vocabulary size that triggers the next rebuild. Raised past twice the
   *  live size after each one, so a vault whose own words are near the bound
   *  does not rebuild on every note it reads. */
  private compactAt = MAX_VOCABULARY;
  /**
   * Answers to recent words. A change to one note patches that note's entry
   * in each of them rather than emptying them all: every autosave re-reads the
   * note being written, and emptying here sent the next draw back over the
   * whole vocabulary — the very walk the answers are kept to spare.
   */
  private readonly answers = new Map<string, Map<string, number>>();

  /** Read one note's text into the index, replacing what it held before. */
  set(path: string, markdown: unknown): void {
    const tokens = tokenize(plainNoteText(markdown, MAX_NOTE_CHARS)).slice(0, MAX_BODY_TOKENS);
    if (this.words.length + tokens.length > this.compactAt) {
      this.notes.delete(path);
      this.compact();
      this.compactAt = Math.max(MAX_VOCABULARY, this.words.length * 2);
    }
    const ids = new Uint32Array(tokens.length);
    tokens.forEach((token, i) => {
      let id = this.vocabulary.get(token);
      if (id === undefined) {
        id = this.words.length;
        this.words.push(token);
        this.vocabulary.set(token, id);
      }
      ids[i] = id;
    });
    this.notes.set(path, ids);
    for (const [word, answer] of this.answers) {
      let best = 0;
      for (const id of ids) best = Math.max(best, forwardMatchStrength(this.words[id] ?? "", word));
      if (best > 0) answer.set(path, best);
      else answer.delete(path);
    }
  }

  /** Every note held, for pruning the ones the vault no longer has. */
  paths(): string[] {
    return [...this.notes.keys()];
  }

  has(path: string): boolean {
    return this.notes.has(path);
  }

  delete(path: string): void {
    if (!this.notes.delete(path)) return;
    for (const answer of this.answers.values()) answer.delete(path);
  }

  /** Everything under a folder: a folder deleted or moved arrives as one event. */
  deleteUnder(folderPath: string): void {
    const prefix = `${folderPath}/`;
    for (const path of [...this.notes.keys()]) {
      if (path.startsWith(prefix)) this.delete(path);
    }
  }

  clear(): void {
    this.answers.clear();
    this.notes.clear();
    this.vocabulary = new Map();
    this.words = [];
    this.compactAt = MAX_VOCABULARY;
  }

  /** How many notes have been read. */
  get size(): number {
    return this.notes.size;
  }

  /** How many distinct words are held, so a test can prove the bound. */
  get vocabularySize(): number {
    return this.words.length;
  }

  strengths(queryToken: string): ReadonlyMap<string, number> {
    const cached = this.answers.get(queryToken);
    if (cached) return cached;
    const out = this.score(queryToken);
    if (this.answers.size >= CACHED_WORDS) {
      const oldest = this.answers.keys().next().value;
      if (oldest !== undefined) this.answers.delete(oldest);
    }
    this.answers.set(queryToken, out);
    return out;
  }

  private score(queryToken: string): Map<string, number> {
    const out = new Map<string, number>();
    if (!queryToken || this.notes.size === 0) return out;
    const scored = new Float32Array(this.words.length);
    let any = false;
    for (let id = 0; id < this.words.length; id++) {
      const strength = forwardMatchStrength(this.words[id] ?? "", queryToken);
      if (strength > 0) {
        scored[id] = strength;
        any = true;
      }
    }
    if (!any) return out;
    for (const [path, ids] of this.notes) {
      let best = 0;
      for (const id of ids) {
        const strength = scored[id] ?? 0;
        if (strength > best) best = strength;
      }
      if (best > 0) out.set(path, best);
    }
    return out;
  }

  /** Rebuild the vocabulary from the notes still held, dropping orphaned words. */
  private compact(): void {
    const words: string[] = [];
    const vocabulary = new Map<string, number>();
    for (const [path, ids] of this.notes) {
      const next = new Uint32Array(ids.length);
      ids.forEach((old, i) => {
        const word = this.words[old] ?? "";
        let id = vocabulary.get(word);
        if (id === undefined) {
          id = words.length;
          words.push(word);
          vocabulary.set(word, id);
        }
        next[i] = id;
      });
      this.notes.set(path, next);
    }
    this.words = words;
    this.vocabulary = vocabulary;
  }
}

/** Where the loader finds notes. The view satisfies it with the vault. */
export interface BodySource {
  /** Every note whose text the filter should know. */
  paths(): readonly string[];
  read(path: string): Promise<string>;
  /** Whether the note is there at all; absent means "assume it is". */
  exists?(path: string): boolean;
}

/** Notes read between two yields, so filling the index never holds the pane. */
const READ_YIELD_EVERY = 16;

/**
 * Fills a `BodyIndex` from the vault and keeps it current.
 *
 * `ensure` reads whatever the index does not hold yet — every note the first
 * time, afterwards only notes that were created, moved or dropped since — and
 * concurrent calls share one pass. `refresh` re-reads one note.
 *
 * Each read is stamped, and only the latest read of a note may land: a note
 * edited while the first pass was still reading it would otherwise be set to
 * the older text after the newer one had already arrived.
 */
export class BodyLoader {
  private running: Promise<boolean> | null = null;
  /** Asked for while a pass ran: it began from an older list of notes. */
  private again = false;
  /** Stopped for good: the pane closed. */
  private cancelled = false;
  /** How long the last pass that read anything took, for the settings. */
  lastReadMs: number | null = null;
  /** The stamp of the read in flight for each path; absent when none is. */
  private readonly stamps = new Map<string, number>();
  private stamp = 0;

  constructor(
    private readonly index: BodyIndex,
    private readonly source: BodySource,
    private readonly pause: () => Promise<void> = () =>
      new Promise((resolve) => setTimeout(resolve, 0)),
    private readonly clock: () => number = () =>
      typeof performance !== "undefined" ? performance.now() : Date.now()
  ) {}

  /**
   * Read every note the index lacks. Resolves true when it read any.
   *
   * Asked while a pass runs, it asks for another once that one ends: a pass
   * reads the list of notes when it starts, so a note renamed or created
   * during it — the rename handler asks precisely to read the new path — was
   * otherwise left out until the next keystroke.
   */
  ensure(): Promise<boolean> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = async (): Promise<boolean> => {
      const started = this.clock();
      let read = false;
      do {
        this.again = false;
        if (await this.fill()) read = true;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ensure() sets it meanwhile
      } while (this.again && !this.cancelled);
      if (read) this.lastReadMs = this.clock() - started;
      return read;
    };
    this.running = run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Stop, and read nothing more: the pane that owned the index is closed. */
  cancel(): void {
    this.cancelled = true;
    this.stamps.clear();
  }

  /** Re-read one note, if the index held it or a pass is under way. */
  async refresh(path: string): Promise<void> {
    if (!this.index.has(path) && this.running === null) return;
    await this.read(path);
  }

  /** Forget a note, and any read of it still in flight. */
  forget(path: string): void {
    this.stamps.delete(path);
    this.index.delete(path);
  }

  /** Forget everything under a folder, reads in flight included. */
  forgetUnder(folderPath: string): void {
    const prefix = `${folderPath}/`;
    for (const path of [...this.stamps.keys()])
      if (path.startsWith(prefix)) this.stamps.delete(path);
    this.index.deleteUnder(folderPath);
  }

  private async fill(): Promise<boolean> {
    if (this.cancelled) return false;
    const paths = this.source.paths();
    // Notes held under a path the vault no longer has — a rename or delete the
    // pane heard only as a folder, a read that landed after its note went.
    const live = new Set(paths);
    for (const held of this.index.paths()) if (!live.has(held)) this.index.delete(held);
    let read = 0;
    for (const path of paths) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- another call may set it while this one awaited
      if (this.cancelled) break;
      if (this.index.has(path)) continue;
      await this.read(path);
      if (++read % READ_YIELD_EVERY === 0) await this.pause();
    }
    return read > 0;
  }

  private async read(path: string): Promise<void> {
    const mine = ++this.stamp;
    this.stamps.set(path, mine);
    let text: string;
    try {
      text = await this.source.read(path);
    } catch {
      // Gone since the pass listed it: nothing to hold. Still there but
      // unreadable (evicted by a sync): an empty entry, so the pass does not
      // ask again on every keystroke.
      if (this.source.exists?.(path) === false) {
        this.stamps.delete(path);
        return;
      }
      text = "";
    }
    if (this.cancelled || this.stamps.get(path) !== mine) return;
    this.stamps.delete(path);
    this.index.set(path, text);
  }
}
