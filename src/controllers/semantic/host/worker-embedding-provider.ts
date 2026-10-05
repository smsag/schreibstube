import {
  PostMessageEmbeddingProvider,
  type BackendChannel,
  type ModelLoadProgress
} from "./post-message-backend";
import type { EmbeddingModelId } from "../../../services/semantic/embedding-models";
import { getEmbeddingBundle } from "./embedding-bundle";
import { withWorkerPrelude } from "./worker-prelude";
import { modelPinFor } from "../../../services/semantic/model-pins";

/**
 * Runs the embedding model in a real Web Worker (Pythia ADR-119) so inference executes on
 * a BACKGROUND thread — unlike the same-origin iframe, which shares Obsidian's UI
 * thread and freezes it while embedding a large vault. The worker is loaded from a
 * Blob URL built from the bundled worker source. If the environment refuses a blob
 * worker (CSP) or the runtime fails, `ready()` rejects and the caller falls back to
 * the iframe provider (see embeddingProviderFactory).
 *
 * Everything about the conversation with the backend — the ping-proven ready poll,
 * requests, timeouts, teardown — is `PostMessageEmbeddingProvider` (Pythia ADR-204). What
 * is here is how a Worker is started and stopped.
 */
export class WorkerEmbeddingProvider extends PostMessageEmbeddingProvider {
  protected readonly label = "Embedding worker";
  private blobUrl: string | null = null;

  constructor(
    modelId: EmbeddingModelId,
    /** The runtime's checked WebAssembly, sent with the model's settings: the
     *  bundle fetches no code of its own (`SearchRuntimeLoader`). */
    private readonly runtime: () => Promise<ArrayBuffer>,
    onProgress?: (p: ModelLoadProgress) => void,
    /** Optional: resolve a same-origin, loadable URL for the worker script (e.g. a
     *  plugin resource path). When omitted, the worker loads from a `blob:` URL.
     *  Some environments (Obsidian mobile, and desktop builds on `capacitor://`)
     *  block `blob:` Workers — a resource-path URL is the blob-free alternative that
     *  keeps inference OFF the UI thread (Pythia ADR-126). */
    private readonly spawnUrl?: () => Promise<string>
  ) {
    super(modelId, onProgress);
  }

  /** A real Web Worker → inference runs off the UI thread. */
  isOffThread(): boolean {
    return true;
  }

  protected async mount(): Promise<BackendChannel> {
    // Ahead of the Worker, so a runtime that cannot be had leaves nothing to tear down.
    const runtime = await this.runtime();
    let url: string;
    if (this.spawnUrl) {
      url = await this.spawnUrl(); // blob-free (resource path)
    } else {
      const blob = new Blob([withWorkerPrelude(getEmbeddingBundle())], { type: "text/javascript" });
      this.blobUrl = URL.createObjectURL(blob);
      url = this.blobUrl;
    }
    let worker: Worker;
    try {
      worker = new Worker(url, { type: "module" });
    } catch (e) {
      // Refused outright (a CSP): no channel will exist for `unload` to close,
      // so the bundle's URL — about a megabyte — is released here.
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = null;
      }
      throw e;
    }
    const onMessage = (event: MessageEvent): void => this.receive(event.data);
    const onError = (event: ErrorEvent): void =>
      this.failLoad(new Error(event.message || "Embedding worker error"));
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    // Copied rather than transferred: the bytes are the loader's, and another
    // load that asked for them at the same moment may be sending them too.
    worker.postMessage({
      type: "init",
      config: this.config,
      runtime,
      pin: modelPinFor(this.config.repoId)
    });
    return {
      send: (message) => worker.postMessage(message),
      close: () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.terminate();
        if (this.blobUrl) {
          URL.revokeObjectURL(this.blobUrl);
          this.blobUrl = null;
        }
      }
    };
  }
}
