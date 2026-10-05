import {
  PostMessageEmbeddingProvider,
  type BackendChannel,
  type ModelLoadProgress
} from "./post-message-backend";
import { getEmbeddingBundle } from "./embedding-bundle";
import type { EmbeddingModelId } from "../../../services/semantic/embedding-models";
import { modelPinFor } from "../../../services/semantic/model-pins";

export type { ModelLoadProgress };

/**
 * Runs the embedding model inside a hidden same-origin iframe (about:srcdoc), the
 * same isolation obsidian-similarity uses: the heavy transformers.js/WASM runtime
 * lives off the plugin's own context, and `main.js` carries only the bundled
 * bootstrap as a string. The LAST resort in the backend chain — inference here
 * shares Obsidian's UI thread, which is why callers throttle a build on it.
 *
 * Same-origin is a choice with a cost, and SECURITY.md says which. A sandboxed
 * frame would have an opaque origin, and an opaque origin has no Cache Storage:
 * the model, 75 to 120 MB, would download again on every start of a device that
 * lands here. What runs in the frame is therefore held to what runs in a
 * Worker — the bundle main.js carries and the WebAssembly checked against its
 * pin, nothing fetched as code — rather than walled off from the window.
 *
 * The conversation with the backend is `PostMessageEmbeddingProvider` (Pythia ADR-204);
 * what is here is how the iframe is mounted and removed, since no unit test
 * can reach this path.
 */
export class IframeEmbeddingProvider extends PostMessageEmbeddingProvider {
  protected readonly label = "Embedding iframe";

  constructor(
    modelId: EmbeddingModelId,
    /** The runtime's checked WebAssembly; see `WorkerEmbeddingProvider`. */
    private readonly runtime: () => Promise<ArrayBuffer>,
    onProgress?: (p: ModelLoadProgress) => void
  ) {
    super(modelId, onProgress);
  }

  /** Same-origin iframe → inference runs on the renderer UI thread, not off it. */
  isOffThread(): boolean {
    return false;
  }

  protected async mount(): Promise<BackendChannel> {
    const runtime = await this.runtime();
    // Wrap the shared backend bundle in a module <script> at runtime; escape any
    // "</script" so it can't terminate the srcdoc script early.
    const srcdoc = `<script type="module">\n${getEmbeddingBundle().replace(/<\/script/gi, "<\\/script")}\n</script>\n`;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("style", "display: none;");
    iframe.srcdoc = srcdoc;
    // The settings and the runtime go in as a message, as they do to a Worker:
    // 14 MB of WebAssembly has no place in the frame's source text. A module
    // script has run by the time its document has loaded, so the frame's
    // listener is there to hear it.
    iframe.addEventListener(
      "load",
      () => {
        iframe.contentWindow?.postMessage(
          { type: "init", config: this.config, runtime, pin: modelPinFor(this.config.repoId) },
          window.origin
        );
      },
      { once: true }
    );
    document.body.appendChild(iframe);

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframe.contentWindow) return;
      this.receive(event.data);
    };
    window.addEventListener("message", onMessage);

    return {
      send: (message) => {
        const win = iframe.contentWindow;
        // Removed from the document under us; the caller turns this into a
        // failed request rather than one that waits out its timeout.
        if (!win) throw new Error("Embedding iframe is not available");
        win.postMessage(message, window.origin);
      },
      close: () => {
        window.removeEventListener("message", onMessage);
        iframe.remove();
      }
    };
  }
}
