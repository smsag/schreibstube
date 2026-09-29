// The seam between the index logic and the embedding runtime: the services
// are tested against fakes of this, and the host's backends implement it.

/** How one embed request is to be treated. */
export interface EmbedOptions {
  /** Someone is waiting for it — a search. It goes ahead of the batches of a
   *  build or sync still waiting for the model. */
  priority?: boolean;
}

export interface EmbeddingProvider {
  /** Output dimensionality — must match the index's stored dim. */
  readonly dim: number;
  /** Resolves once the model is loaded and ready to embed. */
  ready(): Promise<void>;
  /** Embed each input string into a raw (un-normalized) vector, aligned by index. */
  embed(texts: string[], options?: EmbedOptions): Promise<Float32Array[]>;
  /** Release the model/runtime (e.g. tear down the worker/iframe). */
  unload(): void;
  /** True only when inference runs on a BACKGROUND thread (a real Web Worker).
   *  False when it runs on the renderer UI thread (the iframe fallback — e.g. when
   *  the environment blocks blob-URL Workers, which happens on Obsidian mobile AND
   *  on some desktop builds). Meaningful only after `ready()` resolves; callers that
   *  can't await treat `undefined`/absent as "not off-thread" and throttle. */
  isOffThread?(): boolean;
  /** False once a backend that was ready has failed; absent means "assume alive". */
  isAlive?(): boolean;
  /** Whether the last load failed and no load has started since. A manual
   *  build unloads such a provider so its press really loads again. */
  loadFailed?(): boolean;
  /** Release for good: after this, the provider refuses to load again. For a
   *  plugin going away, where a later embed must not start a model nobody holds. */
  dispose?(): void;
}

/**
 * The backend is gone, not the text: unloaded, crashed, never started, or its
 * model would not load.
 *
 * An index that took this for a verdict on the note it was embedding kept the
 * note out of search until someone edited it, and one that carried on to the
 * next note loaded the model again into a provider being torn down. A caller
 * seeing this stops, and tries the notes again later.
 */
export class BackendGoneError extends Error {
  override readonly name = "BackendGoneError";
}

/** Whether `e` says the backend is gone. By name as well, since an error can
 *  cross a realm (a frame) and lose its prototype on the way. */
export function isBackendGone(e: unknown): boolean {
  return e instanceof BackendGoneError || (e instanceof Error && e.name === "BackendGoneError");
}

/** The three backends `FallbackEmbeddingProvider` can land on, in the order it
 *  tries them. Diagnostic identifiers, deliberately readable as-is so a debug log
 *  and a settings line can both print them without a translation table. */
export type EmbeddingBackend = "worker (blob)" | "worker (resource)" | "iframe (UI thread)";
