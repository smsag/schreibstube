import { createLogger, type Logger } from "../../../services/logger";
import type {
  EmbeddingProvider,
  EmbeddingBackend
} from "../../../services/semantic/embedding-provider";
import {
  embeddingModelConfig,
  type EmbeddingModelId
} from "../../../services/semantic/embedding-models";
import { WorkerEmbeddingProvider } from "./worker-embedding-provider";
import { IframeEmbeddingProvider } from "./iframe-embedding-provider";
import type { ModelLoadProgress } from "./post-message-backend";
import {
  EmbeddingOutOfMemoryError,
  isOutOfMemoryError
} from "../../../services/semantic/memory-error";
import { BackendGoneError, isBackendGone } from "../../../services/semantic/embedding-provider";

/**
 * The embedding provider Pythia actually uses (Pythia ADR-119): a Web Worker (off the UI
 * thread) with the same-thread iframe as an automatic fallback. On first use it
 * tries the worker; if the environment refuses a blob worker (CSP) or the worker
 * runtime fails to become ready, it transparently falls back to the iframe — so
 * embedding always works, just on the UI thread (kept responsive by the
 * cooperative-yield throttling in VaultIndexService) when the worker is unavailable.
 *
 * Implements EmbeddingProvider itself so callers (ConversationIndexService /
 * VaultIndexService) are unaware of which backend is live.
 */
/** Which backend is running the model. The label a report can quote (#306):
 *  a silent fall back to the UI thread is what hid that the Worker never ran.
 *  Declared on the seam (`EmbeddingProvider`) and re-exported here, so the
 *  interface does not have to import from one of its own implementations. */
export type { EmbeddingBackend };

export class FallbackEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;
  private active: EmbeddingProvider | null = null;
  private activeBackend: EmbeddingBackend | null = null;
  /** Why each backend the chain tried did NOT start (Pythia ADR-185). #306 made the
   *  WINNER visible; the reason the others lost is the rest of the diagnosis —
   *  "Unsupported device: wasm" and "Not allowed to load local resource: blob:"
   *  are different bugs with different fixes — and it went only to
   *  `console.warn`, where nobody looks until asked. */
  private readonly failures: string[] = [];
  private readyPromise: Promise<void> | null = null;
  /** Bumped by `unload()`. A load that was in flight when it happened belongs to
   *  an older generation and must not engage (#363). */
  private generation = 0;
  /** Backends this load has built and not yet handed over or discarded — the only
   *  handle on a model that is still loading. */
  private readonly starting = new Set<EmbeddingProvider>();
  /** The last load failed and none has started since. */
  private failedLoad = false;
  /** Disposed: no load starts again. */
  private disposed = false;

  constructor(
    private readonly modelId: EmbeddingModelId,
    private readonly onProgress?: (p: ModelLoadProgress) => void,
    /** Optional: resolve a same-origin resource-path URL for the worker script, so
     *  a Worker can start where `blob:` Workers are blocked (Pythia ADR-126). When it
     *  yields a working Worker, inference stays OFF the UI thread. */
    private readonly resourceWorkerUrl?: () => Promise<string>,
    /** Called ONCE, with the backend that actually started (Pythia ADR-182). The chain
     *  is silent by design on the happy path, and that silence is what let a
     *  desktop-wide fallback to the UI thread go unnoticed. */
    private readonly onBackend?: (backend: EmbeddingBackend, failures: string[]) => void,
    /** Where a backend that would not start, and the one that did, are reported. */
    private readonly logger: Pick<Logger, "warn" | "info"> = createLogger(() => false)
  ) {
    this.dim = embeddingModelConfig(modelId).dim;
  }

  private record(backend: EmbeddingBackend, err: unknown): void {
    this.failures.push(`${backend}: ${err instanceof Error ? err.message : String(err)}`);
    // Out of memory ends the chain (Pythia ADR-199). Every backend shares one process,
    // so the next one would load the same model into the same exhausted heap —
    // on iOS that was two more loads, the last on the UI thread.
    if (isOutOfMemoryError(err)) throw new EmbeddingOutOfMemoryError(err);
  }

  ready(): Promise<void> {
    if (this.disposed)
      return Promise.reject(new BackendGoneError("Embedding provider was disposed"));
    if (!this.readyPromise) {
      const load = this.initialize();
      this.readyPromise = load;
      load.catch(() => {
        if (this.readyPromise === load) this.failedLoad = true;
      });
    }
    return this.readyPromise;
  }

  private async initialize(): Promise<void> {
    // Which load this is. `unload()` moves the counter on, and a backend that
    // becomes ready afterwards is released rather than engaged (#363).
    const gen = this.generation;
    // 1. Blob-URL Worker (off-thread; works on most desktops).
    const blobWorker = new WorkerEmbeddingProvider(this.modelId, this.onProgress);
    this.starting.add(blobWorker);
    try {
      await blobWorker.ready();
      return this.engage(blobWorker, "worker (blob)", gen);
    } catch (err) {
      blobWorker.unload();
      this.abandonIfStale(gen);
      this.record("worker (blob)", err);
      this.logger.warn("semantic engine: blob worker unavailable", err);
    } finally {
      this.starting.delete(blobWorker);
    }
    // 2. Resource-path Worker (blob-free; still OFF the UI thread) — for environments
    //    that block blob: Workers (Obsidian mobile, capacitor:// desktop builds).
    if (this.resourceWorkerUrl) {
      const resWorker = new WorkerEmbeddingProvider(
        this.modelId,
        this.onProgress,
        this.resourceWorkerUrl
      );
      this.starting.add(resWorker);
      try {
        await resWorker.ready();
        return this.engage(resWorker, "worker (resource)", gen);
      } catch (err) {
        resWorker.unload();
        this.abandonIfStale(gen);
        this.record("worker (resource)", err);
        this.logger.warn(
          "semantic engine: resource-path worker unavailable — falling back to iframe (UI thread)",
          err
        );
      } finally {
        this.starting.delete(resWorker);
      }
    }
    // 3. Same-origin iframe (LAST resort; runs on the UI thread — throttled by callers).
    const iframe = new IframeEmbeddingProvider(this.modelId, this.onProgress);
    this.starting.add(iframe);
    try {
      await iframe.ready();
      this.engage(iframe, "iframe (UI thread)", gen);
    } finally {
      this.starting.delete(iframe);
    }
  }

  private engage(provider: EmbeddingProvider, backend: EmbeddingBackend, gen: number): void {
    if (gen !== this.generation) {
      // Unloaded while this model was still loading (#363) — a model change, or
      // the plugin going away. Engaging it now would park the loaded model on a
      // provider nobody holds a reference to: on a phone, several hundred MB
      // that no later `unload()` can reach, which is exactly the memory that
      // gets Obsidian killed. Release it and fail the load that asked for it.
      provider.unload();
      throw new BackendGoneError("Embedding provider was unloaded while the model was loading");
    }
    this.active = provider;
    this.activeBackend = backend;
    // Once per model load, at info level: which backend is live is the first
    // thing a performance report needs, and it used to be visible only as the
    // absence of a warning.
    this.logger.info(`semantic engine: ${backend}`);
    this.onBackend?.(backend, [...this.failures]);
  }

  /**
   * Stop a load that was abandoned: unloaded while a backend was starting.
   *
   * Its failure is the unload, not a refusal — the chain used to read it as
   * "this backend cannot run here" and go on to load the model into the next
   * one, twice, the last time on the UI thread, for a provider nobody wanted
   * any more. On a phone that is the load that gets Obsidian killed.
   */
  private abandonIfStale(gen: number): void {
    if (gen !== this.generation)
      throw new BackendGoneError("Embedding provider was unloaded while the model was loading");
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    // A backend that failed after it was ready — a Worker's error event — stays
    // failed; without this every later embed was refused until a restart.
    if (this.active?.isAlive?.() === false) {
      this.logger.warn("semantic engine: the embedding backend failed — starting it again");
      this.unload();
    }
    try {
      await this.ready();
    } catch (e) {
      // A model that will not load is the backend, never the text being embedded.
      if (isOutOfMemoryError(e) || isBackendGone(e)) throw e;
      throw new BackendGoneError(e instanceof Error ? e.message : String(e));
    }
    const active = this.active;
    if (!active) throw new BackendGoneError("Embedding provider was unloaded");
    return active.embed(texts);
  }

  loadFailed(): boolean {
    return this.failedLoad;
  }

  /** Unload, and refuse every later load: the owner is going away. */
  dispose(): void {
    this.disposed = true;
    this.unload();
  }

  /** Reflects the backend that actually initialized: true only if the Worker
   *  engaged (off-thread), false once we fell back to the UI-thread iframe.
   *  Before `ready()` resolves the backend is unknown — report false so callers
   *  throttle rather than assume off-thread. */
  isOffThread(): boolean {
    return this.active?.isOffThread?.() ?? false;
  }

  /** The backend that initialized, or null before `ready()` resolves (#306). */
  backend(): EmbeddingBackend | null {
    return this.activeBackend;
  }

  /** Why the backends ahead of the active one did not start (Pythia ADR-185). Empty
   *  when the first choice won. */
  backendFailures(): string[] {
    return [...this.failures];
  }

  unload(): void {
    // Ahead of everything else: a backend that becomes ready after this point
    // must see a generation it does not belong to (#363).
    this.generation++;
    this.active?.unload();
    // A load in flight owns a Worker or an iframe that `active` cannot reach.
    for (const p of this.starting) p.unload();
    this.starting.clear();
    this.active = null;
    this.activeBackend = null;
    this.failures.length = 0;
    this.readyPromise = null;
    this.failedLoad = false;
  }
}

/** Build the embedding provider: blob Worker → resource-path Worker →
 *  iframe. `resourceWorkerUrl` (if given) resolves a same-origin URL for the worker
 *  script so a Worker can start where `blob:` is blocked (Pythia ADR-126). */
export function createEmbeddingProvider(
  modelId: EmbeddingModelId,
  onProgress?: (p: ModelLoadProgress) => void,
  resourceWorkerUrl?: () => Promise<string>,
  onBackend?: (backend: EmbeddingBackend, failures: string[]) => void,
  logger?: Pick<Logger, "warn" | "info">
): EmbeddingProvider {
  return new FallbackEmbeddingProvider(modelId, onProgress, resourceWorkerUrl, onBackend, logger);
}
